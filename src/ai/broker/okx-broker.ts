/**
 * Live OKX broker adapter (the EXECUTION team's only path to a real account).
 *
 * Delegates to the real `src/channels` broker adapter. When OKX credentials
 * are configured (including demo keys with OKX_DEMO=true), orders route to
 * the OKX account; otherwise the execution tool's paper-book stub is used so
 * dev and tests never touch a real account.
 *
 * A FILLED status always means a real fill: the channels adapter reconciles
 * order state after submission and only reports FILLED on a terminal fill.
 */

import {
  placeMarketOrder as brokerPlaceOrder,
  placeProtectiveReduction as brokerPlaceProtectiveReduction,
} from "../../channels/broker/adapter";

export interface BrokerOrderResult {
  detail?: string;
  entryPrice?: number;
  orderId: string;
  quantity: number;
  status: "FILLED" | "FAILED";
}

export type BrokerDirection = "LONG" | "SHORT";

export async function placeMarketOrder(
  asset: string,
  direction: BrokerDirection,
  positionSizePct: number,
  proposalId: string,
): Promise<BrokerOrderResult> {
  return brokerPlaceOrder(asset, direction, positionSizePct, proposalId);
}

/**
 * Protective reductions use a distinct adapter operation and deterministic
 * position-scoped client ID. They are never routed through the new-risk
 * proposal path, so an armed new-risk kill switch cannot trap exposure.
 */
export async function placeProtectiveReduction(
  asset: string,
  currentDirection: BrokerDirection,
  positionSizePct: number,
  positionId: string,
): Promise<BrokerOrderResult> {
  return brokerPlaceProtectiveReduction(
    asset,
    currentDirection,
    positionSizePct,
    positionId,
  );
}
