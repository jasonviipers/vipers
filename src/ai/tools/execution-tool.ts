/**
 * EXECUTION team logic: the ONLY component allowed to submit broker orders.
 * Emits the order lifecycle result; retries and reconciliation stay inside
 * the execution team's responsibility.
 *
 * When OKX credentials are configured, orders route through the live
 * `src/channels` broker adapter. Otherwise an explicitly configured paper
 * book is used; missing paper capital fails closed so no synthetic balance
 * reaches an execution result.
 *
 * Persistence + idempotency: every outcome is recorded in the `orders`
 * table keyed by the risk-approved proposalId (UNIQUE). A duplicate
 * submission for the same proposal — retry, crash-recovery, double-run —
 * returns the original outcome instead of creating a second order. This
 * replaces the old in-memory Map, which did not survive restarts.
 */

import { resolveExecutionRoute } from "@/ai/capital-engine/execution-mode";
import {
  type CapitalIntent,
  hashCapitalIntent,
} from "@/ai/capital-engine/intent";
import { env } from "@/env";
import { getBrokerCredentials } from "@/lib/broker-credentials";
import { log } from "@/lib/evlog";

import {
  placeProtectiveReduction as brokerPlaceProtectiveReduction,
  placeMarketOrder,
} from "../broker/okx-broker";
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

export function validateExecutionIntent(request: OrderRequest): boolean {
  return Boolean(
    request.intent &&
      request.intentHash &&
      request.intent.proposalId === request.proposalId &&
      request.intent.asset === request.asset &&
      request.intent.direction === request.direction &&
      hashCapitalIntent(request.intent) === request.intentHash,
  );
}

/**
 * Submit an approved protective reduction through the dedicated broker path.
 * This intentionally does not accept a new-risk CapitalIntent: callers must
 * provide the risk kernel's explicit protective approval and position ID.
 */
export async function executeProtectiveReduction(request: {
  approved: boolean;
  asset: string;
  currentDirection: "LONG" | "SHORT";
  positionId: string;
  positionSizePct: number;
}): Promise<OrderResult> {
  if (!request.approved) {
    return {
      detail: "Protective reduction blocked: risk approval is required",
      orderId: `protective_${request.positionId}:o0`,
      quantity: 0,
      status: "FAILED",
    };
  }
  if (!(request.positionSizePct > 0 && request.positionSizePct <= 100)) {
    return {
      detail: "Protective reduction blocked: invalid reduction size",
      orderId: `protective_${request.positionId}:o0`,
      quantity: 0,
      status: "FAILED",
    };
  }

  const credentials = await getBrokerCredentials("okx");
  if (!credentials && process.env.NODE_ENV === "production") {
    return {
      detail:
        "Protective reduction blocked: production broker is not configured",
      orderId: `protective_${request.positionId}:o0`,
      quantity: 0,
      status: "FAILED",
    };
  }

  try {
    const result = credentials
      ? await brokerPlaceProtectiveReduction(
          request.asset,
          request.currentDirection,
          request.positionSizePct,
          request.positionId,
        )
      : {
          detail:
            "Protective reduction requires a configured paper position book",
          orderId: `protective_${request.positionId}:o0`,
          quantity: 0,
          status: "FAILED" as const,
        };
    return {
      detail: result.detail,
      entryPrice: result.entryPrice,
      orderId: result.orderId,
      quantity: result.quantity,
      status: result.status,
    };
  } catch (error) {
    return {
      detail:
        error instanceof Error ? error.message : "protective reduction failed",
      orderId: `protective_${request.positionId}:o0`,
      quantity: 0,
      status: "FAILED",
    };
  }
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
  const credentials = await getBrokerCredentials("okx");
  const route = resolveExecutionRoute({
    credentialMode: credentials?.mode ?? null,
    nodeEnvironment: env.NODE_ENV,
  });
  if (route === "blocked") {
    return {
      detail:
        "Order blocked: production requires explicitly configured demo or live broker credentials",
      orderId: `${request.proposalId}:o0`,
      quantity: 0,
      status: "FAILED",
    };
  }
  const mode: "live" | "paper" = route;

  try {
    const reservation = await reserveOrderSubmission(request, mode);
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
    result = route === "live" ? await liveOrder(request) : paperResult(request);
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
    return {
      detail: `Broker result requires reconciliation: ${result.detail ?? "no detail"}`,
      orderId: result.orderId,
      quantity: result.quantity,
      status: "PENDING",
    };
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
    entryPrice: brokerResult.entryPrice,
    orderId: brokerResult.orderId,
    quantity: brokerResult.quantity,
    status: brokerResult.status,
  };
}
