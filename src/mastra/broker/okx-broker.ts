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

import { placeMarketOrder as brokerPlaceOrder } from "../../channels/broker/adapter";

export interface BrokerOrderResult {
  detail?: string;
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
