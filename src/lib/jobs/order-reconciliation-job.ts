import { and, eq, inArray } from "drizzle-orm";
import type { OrderResult } from "@/ai/tools/execution-tool";
import { recordOrderOutcome } from "@/ai/tools/order-persistence";
import { toInstrumentId } from "@/channels/broker/adapter";
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
 * Reconcile durable PENDING orders against OKX.
 *
 * This worker is deliberately fail-closed:
 * - `filled` is finalized only with a positive exchange fill quantity.
 * - `canceled` with no fill is finalized as FAILED.
 * - `live`, `partially_filled`, lookup errors, invalid payloads, and
 *   partially-filled cancellations remain PENDING for a later pass.
 *
 * The proposal id / deterministic clOrdId is used when a process crashed
 * before the exchange order id was persisted. No new order is submitted.
 */
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
      brokerOrderId: orders.brokerOrderId,
      direction: orders.direction,
      mode: orders.mode,
      positionSizePct: orders.positionSizePct,
      proposalId: orders.proposalId,
    })
    .from(orders)
    .where(inArray(orders.status, ["PENDING"]))
    .limit(Math.max(1, Math.min(limit, DEFAULT_LIMIT)));

  for (const order of pending) {
    summary.checked += 1;

    if (order.mode !== "live") {
      summary.skipped += 1;
      await annotatePending(
        order.proposalId,
        "Paper order remains unresolved; no broker reconciliation source is configured",
      );
      continue;
    }

    try {
      const instrumentId = toInstrumentId(order.asset);
      const brokerOrder = await okxClient.getOrder(
        order.brokerOrderId
          ? { instId: instrumentId, ordId: order.brokerOrderId }
          : { clOrdId: deriveClOrdId(order.proposalId), instId: instrumentId },
      );
      const fillQuantity = Number(
        brokerOrder.accFillSz || brokerOrder.fillSz || 0,
      );

      const entryPrice = Number(brokerOrder.avgPx);
      const decision = classifyReconciliationState({
        avgPrice: entryPrice,
        fillQuantity,
        state: brokerOrder.state,
      });

      if (decision === "finalize_filled") {
        const result: OrderResult = {
          detail: `Reconciled OKX fill ${fillQuantity} ${brokerOrder.instId} @ ${brokerOrder.avgPx || "market"}`,
          entryPrice,
          orderId: brokerOrder.ordId,
          quantity: fillQuantity,
          status: "FILLED",
        };
        await recordOrderOutcome(
          {
            asset: order.asset,
            direction: order.direction,
            positionSizePct: Number(order.positionSizePct),
            proposalId: order.proposalId,
          },
          result,
          "live",
        );
        summary.finalized += 1;
        continue;
      }

      if (decision === "finalize_failed") {
        await recordOrderOutcome(
          {
            asset: order.asset,
            direction: order.direction,
            positionSizePct: Number(order.positionSizePct),
            proposalId: order.proposalId,
          },
          {
            detail: "Reconciled OKX cancellation with no fill",
            orderId: brokerOrder.ordId,
            quantity: 0,
            status: "FAILED",
          },
          "live",
        );
        summary.finalized += 1;
        continue;
      }

      summary.unresolved += 1;
      await annotatePending(
        order.proposalId,
        `OKX order remains unresolved: state=${brokerOrder.state}, filled=${fillQuantity}, avgPx=${entryPrice || "invalid"}`,
      );
    } catch (error) {
      summary.failed += 1;
      log.error(
        error instanceof Error
          ? error
          : new Error(
              `pending order reconciliation failed: ${order.proposalId}`,
            ),
      );
    }
  }

  log.info({
    ...summary,
    job: "order-reconciliation",
  });
  return summary;
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
