import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { agents } from "@/db/schema/agent";
import { orders, positions } from "@/db/schema/trading";
import { recordLedgerOrderEvent } from "@/lib/capital-ledger";
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

export interface OrderReservation {
  duplicate: boolean;
  result?: OrderResult;
}

/**
 * Claim a proposal's idempotency key before contacting a broker. A duplicate
 * or unresolved earlier submission must never result in a second broker call.
 */
export async function reserveOrderSubmission(
  request: OrderRequest,
  mode: "live" | "paper",
): Promise<OrderReservation> {
  const agentId = await resolveExecutionAgentId("order-executor-agent");
  const inserted = await db
    .insert(orders)
    .values({
      agentId,
      asset: request.asset,
      detail: "Order submission reserved; awaiting broker outcome",
      direction: request.direction,
      mode,
      positionSizePct: request.positionSizePct.toString(),
      proposalId: request.proposalId,
      quantity: "0",
      intentHash: request.intentHash ?? "",
      status: "PENDING",
    })
    .onConflictDoNothing({ target: orders.proposalId })
    .returning({ id: orders.id });

  if (inserted.length > 0) {
    return { duplicate: false };
  }

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

  if (existing?.status === "PENDING") {
    return {
      duplicate: true,
      result: {
        detail:
          "Existing submission is unresolved; broker reconciliation is required before retrying this proposal",
        orderId: existing.orderId ?? `${request.proposalId}:o0`,
        quantity: Number(existing.quantity),
        status: "PENDING",
      },
    };
  }

  return {
    duplicate: true,
    result: {
      detail: existing?.detail ?? "duplicate proposal (already recorded)",
      orderId: existing?.orderId ?? `${request.proposalId}:o0`,
      quantity: Number(existing?.quantity ?? 0),
      status: existing?.status === "FILLED" ? "FILLED" : "FAILED",
    },
  };
}

/**
 * Record an order outcome durably and open a position on a real fill.
 *
 * A filled order and its position row commit atomically. If the quote or
 * position write fails, the order remains PENDING so reconciliation can
 * resolve the external broker state instead of exposing a fill without a
 * position or silently losing the failure.
 */
export async function recordOrderOutcome(
  request: OrderRequest,
  result: OrderResult,
  mode: "live" | "paper",
): Promise<PersistedOrderOutcome> {
  let entryPrice: string | undefined;
  if (result.status === "FILLED" && result.quantity > 0) {
    if (result.entryPrice !== undefined && result.entryPrice > 0) {
      entryPrice = result.entryPrice.toString();
    } else {
      const quote = await fetchMarketQuote(request.asset);
      if (quote.stale || !(quote.price > 0)) {
        throw new Error(
          `Cannot persist fill for ${request.asset}: entry quote is stale or invalid`,
        );
      }
      entryPrice = quote.price.toString();
    }
  }

  const finalized = await db.transaction(async (tx) => {
    const updated = await tx
      .update(orders)
      .set({
        brokerOrderId: result.orderId || null,
        detail: result.detail ?? null,
        mode,
        quantity: result.quantity.toString(),
        status: result.status,
      })
      .where(
        and(
          eq(orders.proposalId, request.proposalId),
          eq(orders.status, "PENDING"),
        ),
      )
      .returning({ id: orders.id });

    if (updated.length === 0) {
      return { finalized: false };
    }

    if (result.status === "FILLED" && result.quantity > 0 && entryPrice) {
      const agentId = await resolveExecutionAgentId("order-executor-agent");
      await tx.insert(positions).values({
        accountId: EXECUTION_ACCOUNT,
        agentId,
        asset: request.asset,
        direction: request.direction,
        entryPrice,
        quantity: result.quantity.toString(),
        status: "OPEN",
      });
    }

    return { finalized: true };
  });

  if (!finalized.finalized) {
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

  try {
    await recordLedgerOrderEvent({
      brokerOrderId: result.orderId,
      eventType: result.status,
      idempotencyKey: `order:${request.proposalId}:${result.orderId}:${result.status}:${result.quantity}`,
      payload: {
        asset: request.asset,
        detail: result.detail,
        direction: request.direction,
        quantity: result.quantity,
        status: result.status,
      },
      proposalId: request.proposalId,
    });
  } catch (error) {
    log.error(
      error instanceof Error
        ? error
        : new Error("ledger order event persistence failed"),
    );
  }

  if (result.status === "FILLED") {
    log.info({
      action: "position_opened",
      asset: request.asset,
      job: "order-persistence",
      quantity: result.quantity,
    });
  }
  return { duplicate: false, result };
}
