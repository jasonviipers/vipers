/**
 * EXECUTION team logic: the ONLY component allowed to submit broker orders.
 * Emits the order lifecycle result; retries and reconciliation stay inside
 * the execution team's responsibility.
 *
 * When OKX credentials are configured, orders route through the live
 * `src/channels` broker adapter. Otherwise a paper-book stub is used
 * so development and tests never touch a real account.
 *
 * Persistence + idempotency: every outcome is recorded in the `orders`
 * table keyed by the risk-approved proposalId (UNIQUE). A duplicate
 * submission for the same proposal — retry, crash-recovery, double-run —
 * returns the original outcome instead of creating a second order. This
 * replaces the old in-memory Map, which did not survive restarts.
 */

import { env } from "@/env";
import { log } from "@/lib/evlog";

import { placeMarketOrder } from "../broker/okx-broker";
import { recordOrderOutcome } from "./order-persistence";

export interface OrderRequest {
  asset: string;
  direction: "LONG" | "SHORT";
  positionSizePct: number;
  proposalId: string;
}

export interface OrderResult {
  detail?: string;
  orderId: string;
  quantity: number;
  status: "FILLED" | "FAILED";
}

const NOTIONAL_BOOK = 100_000;

const okxConfigured = Boolean(
  env.OKX_API_KEY && env.OKX_SECRET && env.OKX_PASSPHRASE,
);

function paperResult(request: OrderRequest): OrderResult {
  const quantity = Number(
    ((NOTIONAL_BOOK * request.positionSizePct) / 100).toFixed(2),
  );

  return quantity <= 0
    ? {
        detail: "Computed quantity was zero; nothing sent to broker",
        orderId: `${request.proposalId}:o0`,
        quantity: 0,
        status: "FAILED",
      }
    : {
        detail: `[stub] ${request.direction} ${quantity} ${request.asset} filled on paper book`,
        orderId: `${request.proposalId}:o1`,
        quantity,
        status: "FILLED",
      };
}

export async function placeOrder(request: OrderRequest): Promise<OrderResult> {
  let result: OrderResult;
  const mode: "live" | "paper" = okxConfigured ? "live" : "paper";

  try {
    result = okxConfigured
      ? await liveOrder(request)
      : env.NODE_ENV === "production"
        ? {
            detail:
              "Order blocked: production requires configured OKX live or OKX demo credentials; no synthetic paper fill was created",
            orderId: `${request.proposalId}:o0`,
            quantity: 0,
            status: "FAILED",
          }
        : paperResult(request);
  } catch (error) {
    // The adapter normally converts errors to FAILED, but a throw here
    // (e.g. persistence/agent resolution) must still be recorded loudly.
    result = {
      detail:
        error instanceof Error ? error.message : "order submission failed",
      orderId: `${request.proposalId}:o0`,
      quantity: 0,
      status: "FAILED",
    };
  }

  try {
    const persisted = await recordOrderOutcome(request, result, mode);
    return persisted.result;
  } catch (error) {
    // Persistence failure must not fabricate a success — surface the
    // failure; the deterministic clOrdId keeps an accidental re-send of
    // the same proposal on the same OKX order (live mode).
    log.error(
      error instanceof Error
        ? error
        : new Error("order persistence failed after submission"),
    );
    return result;
  }
}

async function liveOrder(request: OrderRequest): Promise<OrderResult> {
  const brokerResult = await placeMarketOrder(
    request.asset,
    request.direction,
    request.positionSizePct,
    request.proposalId,
  );
  return {
    detail: brokerResult.detail,
    orderId: brokerResult.orderId,
    quantity: brokerResult.quantity,
    status: brokerResult.status,
  };
}
