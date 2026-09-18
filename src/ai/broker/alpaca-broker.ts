/**
 * Live Alpaca broker adapter (EXECUTION's path to an Alpaca account).
 *
 * Routes by the ACTIVE credential slot: demo credentials hit the Alpaca
 * PAPER endpoints, live credentials hit the live API — the same paper-vs-
 * live switch the settings UI drives for OKX. When Alpaca is not
 * configured the execution tool falls back to the paper book / blocked.
 *
 * Idempotency: a deterministic `client_order_id` derived from the proposal
 * id makes retries safe on the exchange (Alpaca de-dupes by it). A FILLED
 * status always means a real fill: the order is polled to a terminal state
 * after submission and only a confirmed fill is reported as FILLED. An
 * order that outlives the poll window is reported FAILED with an
 * unresolved hint so the durable reconciliation job can re-check it.
 */

import { deriveAlpacaClOrdId } from "@/channels/alpaca/auth";
import { alpacaClient } from "@/channels/alpaca/client";
import type { AlpacaOrder } from "@/channels/alpaca/types";
import { ALPACA_EQUITIES } from "@/channels/broker/registry";

export interface BrokerOrderResult {
  detail?: string;
  entryPrice?: number;
  orderId: string;
  quantity: number;
  status: "FILLED" | "FAILED";
}

export type BrokerDirection = "LONG" | "SHORT";

/** Alpaca trading symbols: equities use the plain ticker, crypto uses "BASE/USD". */
function toAlpacaSymbol(asset: string): string {
  const base = asset.toUpperCase().split(/[-/]/)[0];
  if (!base) {
    throw new Error(`Invalid asset: ${asset}`);
  }
  if ((ALPACA_EQUITIES as readonly string[]).includes(base)) {
    return base;
  }
  return `${base}/USD`;
}

function timeInForce(symbol: string): "day" | "ioc" {
  // Crypto market orders are immediate-or-cancel; equities trade as-day.
  return symbol.includes("/") ? "ioc" : "day";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Wait up to the window for a terminal fill state. */
async function reconcileFill(
  order: AlpacaOrder,
  attempts = 6,
  intervalMs = 1500,
): Promise<BrokerOrderResult> {
  let current: AlpacaOrder = order;
  for (let i = 0; i < attempts; i++) {
    await sleep(intervalMs);
    current = await alpacaClient.getOrder(current.id);

    if (current.status === "filled") {
      const filledQty = Number(current.filled_qty ?? 0);
      const avgPrice = Number(current.filled_avg_price ?? 0);
      return {
        detail: `Filled ${filledQty} ${current.symbol} @ ${current.filled_avg_price || "market"}`,
        entryPrice: avgPrice,
        orderId: current.id,
        quantity: filledQty,
        status: "FILLED",
      };
    }
    if (
      current.status === "canceled" ||
      current.status === "expired" ||
      current.status === "rejected"
    ) {
      const filledQty = Number(current.filled_qty ?? 0);
      return {
        detail:
          filledQty > 0
            ? `Partially filled ${filledQty} ${current.symbol}, then ${current.status.replaceAll("_", " ")}`
            : `Order ${current.status.replaceAll("_", " ")} by Alpaca: ${current.id}`,
        orderId: current.id,
        quantity: filledQty,
        status: "FAILED",
      };
    }
  }
  return {
    detail: `Order ${current.id} still ${current.status} after ${(attempts * intervalMs) / 1000}s; NOT confirmed — reconcile manually before treating this as a position`,
    orderId: current.id,
    quantity: Number(current.filled_qty ?? 0),
    // Unconfirmed is not filled. The deterministic client_order_id keeps a
    // later re-check (or duplicate submission) on the same exchange order.
    status: "FAILED",
  };
}

const failed = (
  detail: string,
  proposalId: string,
  extra: Partial<BrokerOrderResult> = {},
): BrokerOrderResult => ({
  detail,
  orderId: `${proposalId}:o0`,
  quantity: 0,
  status: "FAILED",
  ...extra,
});

/**
 * Place an Alpaca market order sized as a percentage of the account's
 * equity. LONG spends USD notional (capped at buying power); SHORT sells
 * base-currency holdings the account already holds (fractional qty).
 *
 * positionSizePct is 0–100. The order is queued with a deterministic
 * client_order_id and polled to a terminal state — only a confirmed fill
 * is reported as FILLED.
 */
export async function placeMarketOrder(
  asset: string,
  direction: BrokerDirection,
  positionSizePct: number,
  proposalId: string,
): Promise<BrokerOrderResult> {
  if (!(positionSizePct > 0 && positionSizePct <= 100)) {
    return failed(
      `Order blocked: position size must be between 0 and 100 percent`,
      proposalId,
    );
  }

  let symbol: string;
  try {
    symbol = toAlpacaSymbol(asset);
  } catch (error) {
    return failed(
      error instanceof Error ? error.message : "Invalid asset",
      proposalId,
    );
  }

  const clientOrderId = deriveAlpacaClOrdId(proposalId);

  try {
    const account = await alpacaClient.getAccount();
    const equity = Number(account.equity);
    if (!Number.isFinite(equity) || equity < 0) {
      return failed("Alpaca returned an unreadable account equity", proposalId);
    }

    let order: AlpacaOrder;
    if (direction === "LONG") {
      const requested = equity * (positionSizePct / 100);
      const buyingPower = Number(account.buying_power);
      const notional = Math.max(0, Math.min(requested, buyingPower || 0));
      if (!(notional > 0) || !Number.isFinite(notional)) {
        return failed(
          `Order blocked: insufficient buying power for a $${positionSizePct}% position (equity $${equity.toFixed(2)}, buying power $${buyingPower.toFixed(2)})`,
          proposalId,
        );
      }
      order = await alpacaClient.placeOrder({
        client_order_id: clientOrderId,
        notional: notional.toFixed(2),
        side: "buy",
        symbol,
        time_in_force: timeInForce(symbol),
        type: "market",
      });
    } else {
      const positions = await alpacaClient.getPositions(symbol);
      const held = Number(positions[0]?.qty ?? 0);
      const qty = held * (positionSizePct / 100);
      if (!(qty > 0) || !Number.isFinite(qty)) {
        return failed(
          `Order blocked: no ${symbol} holdings to reduce (held ${String(positions[0]?.qty ?? 0)})`,
          proposalId,
        );
      }
      order = await alpacaClient.placeOrder({
        client_order_id: clientOrderId,
        qty: qty.toFixed(8),
        side: "sell",
        symbol,
        time_in_force: timeInForce(symbol),
        type: "market",
      });
    }

    const reconciled = await reconcileFill(order);
    return {
      detail: reconciled.detail,
      entryPrice: reconciled.entryPrice,
      orderId: reconciled.orderId,
      quantity: reconciled.quantity,
      status: reconciled.status,
    };
  } catch (error) {
    return failed(
      error instanceof Error ? error.message : "Alpaca broker error",
      proposalId,
    );
  }
}

/**
 * Protective reductions use the dedicated adapter operation and a
 * deterministic position-scoped client id. Never routed through the
 * new-risk proposal path, so an armed new-risk kill switch cannot trap
 * exposure. The active broker owns the position, so reductions follow the
 * same broker the order opener used.
 */
export async function placeProtectiveReduction(
  asset: string,
  currentDirection: BrokerDirection,
  positionSizePct: number,
  positionId: string,
): Promise<BrokerOrderResult> {
  if (!(positionSizePct > 0 && positionSizePct <= 100)) {
    throw new Error(
      "Protective reduction size must be between 0 and 100 percent",
    );
  }
  const reductionDirection: BrokerDirection =
    currentDirection === "LONG" ? "SHORT" : "LONG";
  return placeMarketOrder(
    asset,
    reductionDirection,
    positionSizePct,
    `protective_${positionId}`,
  );
}
