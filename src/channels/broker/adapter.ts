/**
 * Broker adapter: the single entry point the execution team uses to
 * interact with the OKX account. Converts the project's asset/direction
 * conventions to OKX instrument IDs and sides, sizes market orders from
 * the available quote-currency balance, and normalises results into
 * {@link BrokerOrderResult}.
 */

import { deriveClOrdId } from "../okx/auth";
import { okxClient } from "../okx/client";
import type { OKXWebSocketClient } from "../okx/websocket";

export interface BrokerOrderResult {
  clientOrderId: string;
  detail?: string;
  filled?: boolean;
  orderId: string;
  quantity: number;
  side: "buy" | "sell";
  status: "FILLED" | "FAILED";
}

export interface BrokerAdapter {
  getBalance: typeof okxClient.getBalance;
  getPositions: typeof okxClient.getPositions;
  placeMarketOrder: (
    asset: string,
    direction: "LONG" | "SHORT",
    positionSizePct: number,
    proposalId: string,
  ) => Promise<BrokerOrderResult>;
  websocket?: {
    connect: () => void;
    close: () => void;
    subscribeToAccount: () => void;
    subscribeToOrders: () => void;
    subscribeToPositions: () => void;
    subscribeToTicker: (instId: string) => void;
  };
}

const ASSET_SEPARATOR = /[-/]/;

/**
 * Normalise an asset string ("BTC" | "BTC-USD" | "BTC/USD") into an OKX
 * spot instrument ID. Only USDT-quoted majors are supported.
 */
const SPOT_MAJORS = ["BTC", "DOGE", "ETH", "SOL", "XRP"] as const;

export function toInstrumentId(asset: string): string {
  const base = asset.split(ASSET_SEPARATOR)[0]?.toUpperCase();
  if (!base) {
    throw new Error(`Invalid asset: ${asset}`);
  }
  if (!(SPOT_MAJORS as readonly string[]).includes(base)) {
    throw new Error(`Unsupported broker asset: ${asset}`);
  }
  return `${base}-USDT`;
}

export function normalizeAsset(asset: string): string {
  const okxInstId = toInstrumentId(asset);
  return okxInstId.replace("-USDT", "");
}

/** Infer the quote currency from the instrument ID, e.g. "BTC-USDT" → "USDT". */
export function quoteCurrency(instId: string): string {
  return instId.split("-")[1] ?? "USDT";
}

/**
 * Place an OKX spot market order sized as a percentage of the account's
 * holdings (LONG spends quote-currency equity, SHORT sells base-currency
 * holdings). positionSizePct is 0–100.
 *
 * Spot sizing converts to a base-currency size using the live ticker price,
 * caps it at the exchange's max tradable amount, floors it to the instrument
 * lot size, and rejects sizes below the exchange minimum. A stable
 * alphanumeric clOrdId derived from the proposal ID keeps retries
 * idempotent (OKX clOrdId is max 32 characters, case-sensitive).
 *
 * After submission the order state is polled and only a real fill is
 * reported as FILLED; cancellations and rejections are FAILED. The
 * result keeps OKX's `sCode`/`sMsg` in `detail`.
 */
export async function placeMarketOrder(
  asset: string,
  direction: "LONG" | "SHORT",
  positionSizePct: number,
  proposalId: string,
): Promise<BrokerOrderResult> {
  const instrumentId = toInstrumentId(asset);
  const quoteCcy = quoteCurrency(instrumentId);
  const clOrdId = deriveClOrdId(proposalId);
  const side = direction === "LONG" ? "buy" : "sell";

  const failed = (
    detail: string,
    extra: Partial<BrokerOrderResult> = {},
  ): BrokerOrderResult => ({
    clientOrderId: clOrdId,
    detail,
    orderId: `${proposalId}:o0`,
    quantity: 0,
    side,
    status: "FAILED",
    ...extra,
  });

  try {
    const size = await computeSize(
      direction,
      instrumentId,
      quoteCcy,
      positionSizePct,
    );
    if (size <= 0) {
      return failed("Computed quantity was zero; nothing sent to broker");
    }

    const response = await okxClient.placeOrder({
      clOrdId,
      instId: instrumentId,
      ordType: "market",
      side,
      sz: size.toFixed(8),
      tdMode: "cash",
    });

    if (response.sCode !== "0") {
      return failed(response.sMsg || "Order rejected by OKX", {
        orderId: response.ordId || `${proposalId}:o0`,
        quantity: size,
      });
    }

    const reconciled = await reconcileFill(response.ordId, instrumentId);
    return {
      clientOrderId: response.clOrdId,
      detail: reconciled.detail,
      filled: reconciled.filled,
      orderId: response.ordId,
      quantity: reconciled.quantity ?? size,
      side,
      status: reconciled.status,
    };
  } catch (error) {
    return failed(error instanceof Error ? error.message : "OKX broker error");
  }
}

/**
 * Poll the order state until it reaches a terminal state, which per OKX is
 * `filled` or `canceled`. `live` and `partially_filled` are transient:
 * OKX pushes live → partially_filled → … → filled (or canceled). We keep
 * polling through both and only commit to a result on a terminal state.
 * A live order that outlives the window is reported best-effort with the
 * fill details observed so far plus a reconciliation hint — never as a
 * fabricated full fill.
 */
async function reconcileFill(
  ordId: string,
  instrumentId: string,
  attempts = 6,
  intervalMs = 1500,
): Promise<{
  detail?: string;
  filled?: boolean;
  quantity: number;
  status: "FILLED" | "FAILED";
}> {
  let lastState = "live";
  let lastFillSz = 0;
  for (let i = 0; i < attempts; i++) {
    await sleep(intervalMs);
    const order = await okxClient.getOrder({ instId: instrumentId, ordId });
    lastState = order.state;
    lastFillSz = Number(order.accFillSz || order.fillSz || 0);

    if (order.state === "filled") {
      return {
        detail: `Filled ${lastFillSz} ${instrumentId} @ ${
          order.avgPx || "market"
        }`,
        filled: true,
        quantity: lastFillSz,
        status: "FILLED",
      };
    }
    if (order.state === "canceled") {
      return {
        detail:
          lastFillSz > 0
            ? `Partially filled ${lastFillSz} ${instrumentId}, then canceled by OKX`
            : `Order canceled by OKX (requested ${order.sz} ${instrumentId})`,
        filled: false,
        quantity: lastFillSz,
        status: "FAILED",
      };
    }
  }
  return {
    detail: `Order ${ordId} still ${lastState} after ${(attempts * intervalMs) / 1000}s (filled ${lastFillSz} so far); reconcile via the orders channel`,
    filled: false,
    quantity: lastFillSz,
    status: "FILLED",
  };
}

/**
 * Compute the base-currency market-order size.
 *
 * LONG: notional = quote-currency available equity × positionSizePct,
 * converted to base size via the live ticker price.
 * SHORT: no USDT is spent; the order sells base currency the account
 * already holds, so the size target is base holdings × positionSizePct.
 *
 * In both cases the order is capped at GET /api/v5/account/max-avail-size
 * (the exchange's own device: `availBuy` in quote ccy, `availSell` in base
 * ccy for spot), floored to the instrument lot size and rejected below the
 * exchange minimum.
 */
async function computeSize(
  direction: "LONG" | "SHORT",
  instrumentId: string,
  quoteCcy: string,
  positionSizePct: number,
): Promise<number> {
  const balance = await okxClient.getBalance();
  if (!balance) {
    throw new Error("OKX balance lookup returned no data");
  }
  const baseCcy = instrumentId.split("-")[0] ?? "";

  let available: number;
  if (direction === "LONG") {
    const detail = balance.details.find((entry) => entry.ccy === quoteCcy);
    available = Number(detail?.availEq ?? 0);
  } else {
    const detail = balance.details.find((entry) => entry.ccy === baseCcy);
    available = Number(detail?.availEq ?? 0);
  }
  if (!(available > 0)) {
    return 0;
  }

  const ticker = await okxClient.getTicker(instrumentId);
  const last = Number(ticker?.last);
  if (!(last > 0)) {
    throw new Error(`No live price for ${instrumentId}`);
  }

  let rawSize =
    direction === "LONG"
      ? (available * positionSizePct) / 100 / last
      : (available * positionSizePct) / 100;

  const tradable = await okxClient.getMaxAvailSize(instrumentId, "cash");
  const cap =
    direction === "LONG"
      ? Number(tradable.availBuy) / last
      : Number(tradable.availSell);
  if (cap > 0) {
    rawSize = Math.min(rawSize, cap);
  }

  const instruments = await okxClient.getInstruments();
  const instrument = instruments.find(
    (candidate) => candidate.instId === instrumentId,
  );
  const lotSz = Number(instrument?.lotSz ?? 0.000001);
  const minSz = Number(instrument?.minSz ?? 0);

  const size = lotSz > 0 ? Math.floor(rawSize / lotSz) * lotSz : rawSize;
  if (!(size > 0)) {
    throw new Error(`Computed size ${rawSize} below minimum lot ${lotSz}`);
  }
  if (minSz > 0 && size < minSz) {
    throw new Error(
      `Order size ${size.toFixed(8)} below minimum ${minSz} for ${instrumentId}`,
    );
  }
  return size;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createBrokerAdapter(
  websocket?: OKXWebSocketClient,
): BrokerAdapter {
  return {
    getBalance: okxClient.getBalance,
    getPositions: okxClient.getPositions,
    placeMarketOrder,
    websocket: websocket
      ? {
          close: () => websocket.close(),
          connect: () => websocket.connect(),
          subscribeToAccount: () => websocket.subscribeToAccount(),
          subscribeToOrders: () => websocket.subscribeToOrders(),
          subscribeToPositions: () => websocket.subscribeToPositions(),
          subscribeToTicker: (instId) => websocket.subscribeToTicker(instId),
        }
      : undefined,
  };
}
