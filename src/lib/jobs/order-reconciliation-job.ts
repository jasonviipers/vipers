import { and, eq, inArray } from "drizzle-orm";
import type { OrderResult } from "@/ai/tools/execution-tool";
import { recordOrderOutcome } from "@/ai/tools/order-persistence";
import { deriveAlpacaClOrdId } from "@/channels/alpaca/auth";
import { alpacaClient } from "@/channels/alpaca/client";
import type { AlpacaOrderStatus } from "@/channels/alpaca/types";
import { toInstrumentId } from "@/channels/broker/adapter";
import type { BrokerId } from "@/channels/broker/registry";
import { deriveClOrdId } from "@/channels/okx/auth";
import { okxClient } from "@/channels/okx/client";
import { db } from "@/db";
import { orders } from "@/db/schema/trading";
import { log } from "@/lib/evlog";
import { classifyReconciliationState } from "./order-reconciliation-policy";

const DEFAULT_LIMIT = 100;

export interface ReconciliationSummary {
  checked: number;
  finalized: number;
  unresolved: number;
  failed: number;
  skipped: number;
}

/**
 * Reconcile durable PENDING orders against their broker (per order row's
 * `brokerId`), dispatching to the OKX or Alpaca channel.
 *
 * This worker is deliberately fail-closed:
 * - `filled` is finalized only with a positive exchange fill quantity AND a
 *   readable average fill price.
 * - zero-fill terminal states (canceled / expired / rejected) are finalized
 *   as FAILED.
 * - live, partially_filled, lookup errors, invalid payloads, and
 *   partially-filled cancellations remain PENDING for a later pass.
 *
 * The proposal id / deterministic client order id is used when a process
 * crashed before the broker's order id was persisted. No new order is
 * submitted.
 */
// instrumentation.ts job entry point (startOrderReconciliationJob).
// fallow-ignore-next-line
export async function reconcilePendingOrders(
  limit = DEFAULT_LIMIT,
): Promise<ReconciliationSummary> {
  const summary: ReconciliationSummary = {
    checked: 0,
    failed: 0,
    finalized: 0,
    skipped: 0,
    unresolved: 0,
  };

  const pending = await db
    .select({
      asset: orders.asset,
      brokerId: orders.brokerId,
      brokerOrderId: orders.brokerOrderId,
      direction: orders.direction,
      mode: orders.mode,
      positionSizePct: orders.positionSizePct,
      proposalId: orders.proposalId,
    })
    .from(orders)
    .where(inArray(orders.status, ["PENDING"]))
    .limit(Math.max(1, Math.min(limit, DEFAULT_LIMIT)));

  // Each pending order is independent: broker lookups + paper annotations
  // run concurrently, while per-order error handling is kept local.
  await Promise.all(
    pending.map(async (order) => {
      summary.checked += 1;

      if (order.mode !== "live") {
        summary.skipped += 1;
        await annotatePending(
          order.proposalId,
          "Paper order remains unresolved; no broker reconciliation source is configured",
        );
        return;
      }

      const brokerId: BrokerId = order.brokerId === "alpaca" ? "alpaca" : "okx";
      let finalized: boolean;
      try {
        finalized =
          brokerId === "alpaca"
            ? await reconcileAlpacaOrder(order)
            : await reconcileOkxOrder(order);
      } catch (error) {
        summary.failed += 1;
        log.error(
          error instanceof Error
            ? error
            : new Error(
                `pending order reconciliation failed: ${order.proposalId}`,
              ),
        );
        return;
      }
      if (finalized) {
        summary.finalized += 1;
      } else {
        summary.unresolved += 1;
      }
    }),
  );

  log.info({
    ...summary,
    job: "order-reconciliation",
  });
  return summary;
}

interface PendingOrder {
  asset: string;
  brokerId: string;
  brokerOrderId: string | null;
  direction: "LONG" | "SHORT";
  positionSizePct: string;
  proposalId: string;
}

/** Reconcile one OKX order; returns true when it was finalized durably. */
async function reconcileOkxOrder(order: PendingOrder): Promise<boolean> {
  const instrumentId = toInstrumentId(order.asset);
  const brokerOrder = await okxClient.getOrder(
    order.brokerOrderId
      ? { instId: instrumentId, ordId: order.brokerOrderId }
      : { clOrdId: deriveClOrdId(order.proposalId), instId: instrumentId },
  );
  const fillQuantity = Number(brokerOrder.accFillSz || brokerOrder.fillSz || 0);

  const entryPrice = Number(brokerOrder.avgPx);
  const decision = classifyReconciliationState({
    avgPrice: entryPrice,
    fillQuantity,
    state: brokerOrder.state,
  });

  if (decision === "finalize_filled") {
    return finalizeOrder(order, {
      detail: `Reconciled OKX fill ${fillQuantity} ${brokerOrder.instId} @ ${brokerOrder.avgPx || "market"}`,
      entryPrice,
      orderId: brokerOrder.ordId,
      quantity: fillQuantity,
      status: "FILLED",
    });
  }

  if (decision === "finalize_failed") {
    return finalizeOrder(order, {
      detail: "Reconciled OKX cancellation with no fill",
      orderId: brokerOrder.ordId,
      quantity: 0,
      status: "FAILED",
    });
  }

  await annotatePending(
    order.proposalId,
    `OKX order remains unresolved: state=${brokerOrder.state}, filled=${fillQuantity}, avgPx=${entryPrice || "invalid"}`,
  );
  return false;
}

/** Reconcile one Alpaca order; returns true when it was finalized durably. */
async function reconcileAlpacaOrder(order: PendingOrder): Promise<boolean> {
  const brokerOrder = order.brokerOrderId
    ? await alpacaClient.getOrder(order.brokerOrderId)
    : await alpacaClient.getOrderByClientOrderId(
        deriveAlpacaClOrdId(order.proposalId),
      );

  const fillQuantity = Number(brokerOrder.filled_qty ?? 0);
  const entryPrice = Number(brokerOrder.filled_avg_price ?? 0);
  const state = mapAlpacaStatus(brokerOrder.status);
  const decision = classifyReconciliationState({
    avgPrice: entryPrice,
    fillQuantity,
    state,
  });

  if (decision === "finalize_filled") {
    return finalizeOrder(order, {
      detail: `Reconciled Alpaca fill ${fillQuantity} ${brokerOrder.symbol} @ ${brokerOrder.filled_avg_price || "market"}`,
      entryPrice,
      orderId: brokerOrder.id,
      quantity: fillQuantity,
      status: "FILLED",
    });
  }

  if (decision === "finalize_failed") {
    return finalizeOrder(order, {
      detail: `Reconciled Alpaca order ${brokerOrder.status} with no fill`,
      orderId: brokerOrder.id,
      quantity: 0,
      status: "FAILED",
    });
  }

  await annotatePending(
    order.proposalId,
    `Alpaca order remains unresolved: status=${brokerOrder.status}, filled=${fillQuantity}, avgPx=${entryPrice || "invalid"}`,
  );
  return false;
}

/**
 * Map an Alpaca order status onto the classifier's vocabulary. Zero-fill
 * terminal states map to "expired"/"rejected" (finalized FAILED by the
 * policy); "done_for_day" is terminal for equities and carries real fills.
 */
function mapAlpacaStatus(
  status: AlpacaOrderStatus,
): Parameters<typeof classifyReconciliationState>[0]["state"] {
  switch (status) {
    case "filled":
      return "filled";
    case "done_for_day":
      return "filled";
    case "canceled":
      return "canceled";
    case "expired":
      return "expired";
    case "rejected":
      return "rejected";
    default:
      // new / held / accepted / partial_fill / pending_* / replaced* /
      // suspended → treat as in-flight, never terminal.
      return "live";
  }
}

/** Persist a finalized outcome (synchronized with the broker); true on success. */
async function finalizeOrder(
  order: PendingOrder,
  result: OrderResult,
): Promise<boolean> {
  await recordOrderOutcome(
    {
      asset: order.asset,
      direction: order.direction,
      positionSizePct: Number(order.positionSizePct),
      proposalId: order.proposalId,
    },
    result,
    "live",
    order.brokerId === "alpaca" ? "alpaca" : "okx",
  );
  return true;
}

async function annotatePending(
  proposalId: string,
  detail: string,
): Promise<void> {
  await db
    .update(orders)
    .set({ detail })
    .where(
      and(eq(orders.proposalId, proposalId), eq(orders.status, "PENDING")),
    );
}
