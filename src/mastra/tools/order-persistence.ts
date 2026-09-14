import { eq } from "drizzle-orm";

import { db } from "@/db";
import { agents } from "@/db/schema/agent";
import { orders, positions } from "@/db/schema/trading";
import { log } from "@/lib/evlog";
import type { OrderRequest, OrderResult } from "./execution-tool";
import { fetchMarketQuote } from "./market-quote-tool";

/**
 * EXECUTION persistence: durable order records + position creation.
 *
 * Every executed order gets an `orders` row keyed by the risk-approved
 * `proposalId` (UNIQUE). That constraint is the durable idempotency layer:
 * a retried or duplicate submission for the same proposal hits the unique
 * index, returns the original result, and never creates a second order —
 * surviving process restarts, unlike the in-memory Map.
 *
 * A FILLED result also opens a `positions` row (status OPEN, pnl 0) so the
 * positions UI, portfolio rollups, and agent stats derive from real fills.
 * A FAILED/BLOCKED order records the outcome for audit and returns it —
 * it must not be retried blindly by the caller (the adapter's clOrdId and
 * this table's unique constraint both make accidental retries safe).
 */

const EXECUTION_ACCOUNT = "system";

/** Which agent actually drove execution for this order (FK target). */
async function resolveExecutionAgentId(requestedId: string): Promise<string> {
  const [row] = await db
    .select({ id: agents.id })
    .from(agents)
    .where(eq(agents.id, requestedId))
    .limit(1);
  if (row) {
    return row.id;
  }
  // Fall back to the order-executor agent config id; if even that is
  // missing the DB has not been seeded and persistence fails closed.
  const FALLBACK = "order-executor-agent";
  const [fallback] = await db
    .select({ id: agents.id })
    .from(agents)
    .where(eq(agents.id, FALLBACK))
    .limit(1);
  if (fallback) {
    return fallback.id;
  }
  throw new Error(
    "No agent row available for order persistence (agents table not seeded)",
  );
}

export interface PersistedOrderOutcome {
  /** True when an earlier order for this proposal already existed. */
  duplicate: boolean;
  result: OrderResult;
}

/**
 * Record an order outcome durably and open a position on a real fill.
 * Safe to call multiple times for the same proposalId.
 */
export async function recordOrderOutcome(
  request: OrderRequest,
  result: OrderResult,
  mode: "live" | "paper",
): Promise<PersistedOrderOutcome> {
  const agentId = await resolveExecutionAgentId("order-executor-agent");

  const inserted = await db
    .insert(orders)
    .values({
      agentId,
      asset: request.asset,
      brokerOrderId: result.orderId || null,
      detail: result.detail ?? null,
      direction: request.direction,
      mode,
      positionSizePct: request.positionSizePct.toString(),
      proposalId: request.proposalId,
      quantity: result.quantity.toString(),
      status: result.status,
    })
    .onConflictDoNothing({ target: orders.proposalId })
    .returning({ id: orders.id });

  if (inserted.length === 0) {
    // Unique constraint hit: this proposal was already submitted (retry
    // after crash, duplicate event, double-run). Return the original
    // outcome instead of creating a second order.
    const [existing] = await db
      .select({
        detail: orders.detail,
        orderId: orders.brokerOrderId,
        quantity: orders.quantity,
        status: orders.status,
      })
      .from(orders)
      .where(eq(orders.proposalId, request.proposalId))
      .limit(1);

    log.info({
      action: "duplicate_suppressed",
      job: "order-persistence",
      proposalId: request.proposalId,
    });

    // BLOCKED is never persisted by placeOrder, but narrow defensively:
    // a blocked outcome is not a fill, so treat it as FAILED for callers.
    const status: OrderResult["status"] =
      existing?.status === "FILLED" ? "FILLED" : "FAILED";

    return {
      duplicate: true,
      result: {
        detail: existing?.detail ?? "duplicate proposal (already recorded)",
        orderId: existing?.orderId ?? result.orderId,
        quantity: Number(existing?.quantity ?? result.quantity),
        status,
      },
    };
  }

  // FILLED → open a position row so the rest of the system derives from
  // real fills. On live fills the adapter reports the real fill quantity;
  // paper mode uses the notional book value.
  if (result.status === "FILLED" && result.quantity > 0) {
    await openPositionFromFill(request, result);
  }

  return { duplicate: false, result };
}

async function openPositionFromFill(
  request: OrderRequest,
  result: OrderResult,
): Promise<void> {
  try {
    const agentId = await resolveExecutionAgentId("order-executor-agent");

    // Entry price: the real fill price in live mode comes from the
    // adapter's detail ("Filled N @ px"); for paper fills, use the live
    // market quote. If the quote is unavailable, the row keeps 0 and the
    // price-tick/UI layers degrade gracefully (documented limitation).
    let entryPrice = "0";
    try {
      const quote = await fetchMarketQuote(request.asset);
      entryPrice = quote.price.toString();
    } catch {
      log.error(new Error("entry-price quote unavailable for position row"));
    }

    await db.insert(positions).values({
      accountId: EXECUTION_ACCOUNT,
      agentId,
      asset: request.asset,
      direction: request.direction,
      entryPrice,
      quantity: result.quantity.toString(),
      status: "OPEN",
    });
    log.info({
      action: "position_opened",
      asset: request.asset,
      job: "order-persistence",
      quantity: result.quantity,
    });
  } catch (error) {
    // The order is real and recorded; a position-row failure must not
    // corrupt the order outcome, but it must be loud.
    log.error(
      error instanceof Error
        ? error
        : new Error("failed to open position row after fill"),
    );
  }
}
