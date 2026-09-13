/**
 * EXECUTION team logic: the ONLY component allowed to submit broker orders.
 * Emits the order lifecycle result; retries and reconciliation stay inside
 * the execution team's responsibility.
 *
 * When OKX credentials are configured, orders route through the live
 * `src/channels` broker adapter. Otherwise a paper-book stub is used
 * so development and tests never touch a real account.
 */

import { env } from "@/env";

import { placeMarketOrder } from "../broker/okx-broker";

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

// In-memory dedup by proposalId. This is a stop-gap: it prevents a double
// submission within a single process/run, but does NOT survive a restart
// or work across replicas. Before real capital flows through this, back
// this with a unique constraint on proposal_id in Postgres (storage.ts
// already gives you a Postgres connection) so idempotency holds across
// restarts and horizontal scaling.
const submittedOrders = new Map<string, OrderResult>();

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
  const existing = submittedOrders.get(request.proposalId);
  if (existing) {
    return existing;
  }

  let result: OrderResult;
  if (okxConfigured) {
    const brokerResult = await placeMarketOrder(
      request.asset,
      request.direction,
      request.positionSizePct,
      request.proposalId,
    );
    result = {
      detail: brokerResult.detail,
      orderId: brokerResult.orderId,
      quantity: brokerResult.quantity,
      status: brokerResult.status,
    };
  } else {
    result = paperResult(request);
  }

  submittedOrders.set(request.proposalId, result);
  return result;
}
