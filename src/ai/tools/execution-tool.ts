/**
 * EXECUTION team logic: the ONLY component allowed to submit broker orders.
 * Emits the order lifecycle result; retries and reconciliation stay inside
 * the execution team's responsibility.
 *
 * Orders route through the ACTIVE broker (a durable runtime setting) via
 * resolveActiveBrokerRoute():
 *   - OKX: demo creds → local paper book, live creds → OKX live API.
 *   - Alpaca: demo creds → Alpaca PAPER API, live creds → Alpaca live API.
 * An unconfigured active broker falls back to the explicitly configured
 * paper book; missing paper capital fails closed so no synthetic balance
 * reaches an execution result.
 *
 * Persistence + idempotency: every outcome is recorded in the `orders`
 * table keyed by the risk-approved proposalId (UNIQUE). A duplicate
 * submission for the same proposal — retry, crash-recovery, double-run —
 * returns the original outcome instead of creating a second order. This
 * replaces the old in-memory Map, which did not survive restarts.
 */

import {
  type CapitalIntent,
  hashCapitalIntent,
} from "@/ai/capital-engine/intent";
import { env } from "@/env";
import { log } from "@/lib/evlog";

import { placeMarketOrder as alpacaPlaceMarketOrder } from "../broker/alpaca-broker";
import { resolveActiveBrokerRoute } from "../broker/broker-router";
import { placeMarketOrder as okxPlaceMarketOrder } from "../broker/okx-broker";
import {
  recordOrderOutcome,
  reserveOrderSubmission,
} from "./order-persistence";

export interface OrderRequest {
  asset: string;
  direction: "LONG" | "SHORT";
  positionSizePct: number;
  proposalId: string;
  /** The exact proposal/evidence object approved by the risk gate. */
  intent?: CapitalIntent;
  /** SHA-256 hash of `intent`; required at the broker boundary. */
  intentHash?: string;
}

export interface OrderResult {
  detail?: string;
  entryPrice?: number;
  orderId: string;
  quantity: number;
  /** PENDING means a broker result requires durable reconciliation. */
  status: "FILLED" | "FAILED" | "PENDING";
}

function paperResult(request: OrderRequest): OrderResult {
  const notional = env.PAPER_BOOK_NOTIONAL_USD;
  if (notional === undefined) {
    return {
      detail:
        "Order blocked: paper execution requires PAPER_BOOK_NOTIONAL_USD; no synthetic balance is allowed",
      orderId: `${request.proposalId}:o0`,
      quantity: 0,
      status: "FAILED",
    };
  }

  const quantity = Number(
    ((notional * request.positionSizePct) / 100).toFixed(2),
  );

  return quantity <= 0
    ? {
        detail: "Computed quantity was zero; nothing sent to broker",
        orderId: `${request.proposalId}:o0`,
        quantity: 0,
        status: "FAILED",
      }
    : {
        detail: `${request.direction} ${quantity} ${request.asset} filled on configured paper book ($${notional.toFixed(2)} notional)`,
        orderId: `${request.proposalId}:o1`,
        quantity,
        status: "FILLED",
      };
}

function validateExecutionIntent(request: OrderRequest): boolean {
  return Boolean(
    request.intent &&
      request.intentHash &&
      request.intent.proposalId === request.proposalId &&
      request.intent.asset === request.asset &&
      request.intent.direction === request.direction &&
      hashCapitalIntent(request.intent) === request.intentHash,
  );
}

export async function placeOrder(request: OrderRequest): Promise<OrderResult> {
  if (!validateExecutionIntent(request)) {
    return {
      detail:
        "Order blocked: execution intent is missing or does not match its content hash",
      orderId: `${request.proposalId}:o0`,
      quantity: 0,
      status: "FAILED",
    };
  }

  let result: OrderResult;
  const route = await resolveActiveBrokerRoute({
    nodeEnvironment: env.NODE_ENV,
  });
  if (route.status === "blocked") {
    return {
      detail:
        "Order blocked: production requires explicitly configured demo or live broker credentials",
      orderId: `${request.proposalId}:o0`,
      quantity: 0,
      status: "FAILED",
    };
  }
  const { brokerId, mode } = route;

  try {
    const reservation = await reserveOrderSubmission(request, mode, brokerId);
    if (reservation.duplicate) {
      return (
        reservation.result ?? {
          detail: "duplicate proposal (already reserved)",
          orderId: `${request.proposalId}:o0`,
          quantity: 0,
          status: "FAILED",
        }
      );
    }
  } catch (error) {
    log.error(
      error instanceof Error
        ? error
        : new Error("order reservation failed before broker submission"),
    );
    return {
      detail: "Order blocked: unable to reserve its idempotency key",
      orderId: `${request.proposalId}:o0`,
      quantity: 0,
      status: "FAILED",
    };
  }

  try {
    result =
      route.executionRoute === "live"
        ? await liveOrder(request, brokerId)
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
    const persisted = await recordOrderOutcome(request, result, mode, brokerId);
    return persisted.result;
  } catch (error) {
    // Persistence failure must not fabricate a success — surface the
    // failure; the deterministic clOrdId keeps an accidental re-send of
    // the same proposal on the same exchange order.
    log.error(
      error instanceof Error
        ? error
        : new Error("order persistence failed after submission"),
    );
    return {
      detail: `Broker result requires reconciliation: ${result.detail ?? "no detail"}`,
      orderId: result.orderId,
      quantity: result.quantity,
      status: "PENDING",
    };
  }
}

async function liveOrder(
  request: OrderRequest,
  brokerId: "okx" | "alpaca",
): Promise<OrderResult> {
  const brokerResult =
    brokerId === "alpaca"
      ? await alpacaPlaceMarketOrder(
          request.asset,
          request.direction,
          request.positionSizePct,
          request.proposalId,
        )
      : await okxPlaceMarketOrder(
          request.asset,
          request.direction,
          request.positionSizePct,
          request.proposalId,
        );
  return {
    detail: brokerResult.detail,
    entryPrice: brokerResult.entryPrice,
    orderId: brokerResult.orderId,
    quantity: brokerResult.quantity,
    status: brokerResult.status,
  };
}
