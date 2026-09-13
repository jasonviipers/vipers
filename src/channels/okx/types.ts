/**
 * OKX API v5 type definitions.
 */

export interface OKXConfig {
  apiKey: string;
  passphrase: string;
  restBaseUrl: string;
  secretKey: string;
  simulated?: boolean;
  wsBaseUrl: string;
}

export interface OKXResponse<T> {
  code: string;
  data: T[];
  inTime?: string;
  msg: string;
  outTime?: string;
}

// ── Order ────────────────────────────────────────────────────────────

export interface OrderRequest {
  /** Client-specified order ID for idempotency */
  clOrdId?: string;
  /** Instrument ID, e.g. "BTC-USDT" */
  instId: string;
  ordType: "market" | "limit";
  /** Price for limit orders */
  px?: string;
  side: "buy" | "sell";
  /** Size in base currency */
  sz: string;
  /** Trade mode: "cash" for spot, "cross" or "isolated" for margin/derivatives */
  tdMode: "cash" | "cross" | "isolated";
}

export interface OrderResponse {
  avgPx: string;
  clOrdId: string;
  ordId: string;
  sCode: string;
  sMsg: string;
  tag: string;
}

export interface GetOrderParams {
  clOrdId?: string;
  instId: string;
  ordId?: string;
}

export interface OrderDetail {
  accFillSz: string;
  avgPx: string;
  clOrdId: string;
  fillPx: string;
  fillSz: string;
  fillTime: string;
  instId: string;
  instType: string;
  ordId: string;
  ordType: string;
  side: string;
  state: "canceled" | "filled" | "live" | "partially_filled";
  sz: string;
  tdMode: string;
  uTime: string;
}

// ── Account ──────────────────────────────────────────────────────────

export interface AccountBalance {
  details: AccountDetailBalance[];
  eqUsd: string;
  imr: string;
  mgnRatio: string;
  mmr: string;
  notionalUsd: string;
  totalEq: string;
  udTime: string;
  upl: string;
}

export interface AccountDetailBalance {
  availBal: string;
  availEq: string;
  cashBal: string;
  ccy: string;
  eq: string;
  eqUsd: string;
  frozenBal: string;
  interest: string;
  interestRate: string;
  loan: string;
  maxLoan: string;
  ordFrozen: string;
  upl: string;
  uTime: string;
}

/**
 * GET /api/v5/account/max-avail-size — maximum tradable amount for an
 * instrument. For spot, `availBuy` is in quote currency and `availSell` is
 * in base currency.
 */
export interface MaxAvailSize {
  availBuy: string;
  availSell: string;
  instId: string;
}

export interface Position {
  avgPx: string;
  ccy: string;
  cTime: string;
  instId: string;
  instType: string;
  lever: string;
  liqPx: string;
  mgnMode: string;
  nominalLever: string;
  pos: string;
  posCcy: string;
  posId: string;
  posSide: string;
  sz: string;
  tradeMode: number;
  unrealizedPnl: string;
  upl: string;
  uplRatio: string;
  uTime: string;
}

// ── Instrument ───────────────────────────────────────────────────────

export interface Instrument {
  baseCcy: string;
  ctMult: string;
  instId: string;
  instType: string;
  minSz: string;
  quoteCcy: string;
  tickSz: string;
}

export interface Ticker {
  askPx: string;
  bidPx: string;
  instId: string;
  last: string;
  ts: string;
}

// ── WebSocket ────────────────────────────────────────────────────────

export interface WSLoginArgs {
  apiKey: string;
  passphrase: string;
  sign: string;
  timestamp: string;
}

export interface WSLoginMessage {
  args: WSLoginArgs[];
  op: "login";
}

export interface WSSubscribeMessage {
  args: { channel: string; instId?: string }[];
  op: "subscribe";
}

export interface WSHighLevelMessage {
  arg?: {
    channel: string;
    instId: string;
  };
  event?: string;
  msg?: string;
  op: string;
}

export interface WSTickerMessage {
  arg: {
    channel: string;
    instId: string;
  };
  data: WSTicker[];
}

export interface WSTicker {
  askPx: string;
  askSz: string;
  bidPx: string;
  bidSz: string;
  high24h: string;
  instId: string;
  last: string;
  lastSz: string;
  low24h: string;
  open24h: string;
  ts: string;
  vol24h: string;
  volCcy24h: string;
}

export interface WSOrderMessage {
  arg: {
    channel: string;
    instId?: string;
    instType: string;
  };
  data: WSOrderUpdate[];
}

export interface WSOrderUpdate {
  accFillSz: string;
  avgPx: string;
  clOrdId: string;
  cTime: string;
  fillPx: string;
  fillSz: string;
  fillTime: string;
  instId: string;
  instType: string;
  ordId: string;
  ordType: string;
  side: string;
  state: string;
  sz: string;
  tdMode: string;
  uTime: string;
}

export interface WSAccountMessage {
  arg: {
    channel: string;
  };
  data: AccountBalance[];
}

export interface WSPositionMessage {
  arg: {
    channel: string;
  };
  data: Position[];
}
