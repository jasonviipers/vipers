/**
 * Alpaca Markets trading + market data API type definitions.
 */

export interface AlpacaConfig {
  /** APCA-API-KEY-ID header value. */
  apiKeyId: string;
  dataBaseUrl: string;
  /** "paper" | "live" — which account the current key belongs to. */
  mode: "paper" | "live";
  restBaseUrl: string;
  secretKey: string;
}

export interface AlpacaErrorPayload {
  code?: number;
  message?: string;
}

// ── Account ────────────────────────────────────────────────────────────────

export interface AlpacaAccount {
  buying_power: string;
  cash: string;
  currency: string;
  equity: string;
  long_market_value: string;
  pattern_day_trader: boolean;
  status: string;
}

// ── Order ──────────────────────────────────────────────────────────────────

export interface AlpacaOrderRequest {
  /** Required only when not using `notional`. */
  qty?: string;
  /** Required only when not using `qty` (USD notional for market orders). */
  notional?: string;
  client_order_id?: string;
  side: "buy" | "sell";
  symbol: string;
  time_in_force: "day" | "gtc" | "ioc";
  type: "market";
}

export type AlpacaOrderStatus =
  | "accepted"
  | "canceled"
  | "done_for_day"
  | "expired"
  | "filled"
  | "held"
  | "new"
  | "partial_fill"
  | "pending_cancel"
  | "pending_new"
  | "pending_replace"
  | "pending_update"
  | "replaced"
  | "replaced_after_held"
  | "replaced_by_cancel"
  | "rejected"
  | "suspended"
  | "calculated";

export interface AlpacaOrder {
  client_order_id: string;
  filled_avg_price: string | null;
  filled_qty: string;
  id: string;
  notional?: string;
  qty: string;
  side: "buy" | "sell";
  status: AlpacaOrderStatus;
  submitted_at: string;
  symbol: string;
  type: "market";
  updated_at: string;
}

export interface AlpacaPosition {
  avg_entry_price: string;
  current_price: string;
  market_value: string;
  qty: string;
  side: "long" | "short";
  symbol: string;
  unrealized_pl: string;
}

// ── Market data ────────────────────────────────────────────────────────────

export interface AlpacaBar {
  c: number;
  h: number;
  l: number;
  o: number;
  t: number;
  v: number;
}

export interface AlpacaCryptoLatestBarsResponse {
  bars: Record<string, AlpacaBar>;
}

export interface AlpacaEquityLatestBarResponse {
  bar: AlpacaBar | null;
  symbol: string;
}

/** Paginated historical-bars response (equities v2 / crypto v1beta3). */
export interface AlpacaHistoricalBarsResponse {
  bars: AlpacaBar[] | null;
  next_page_token?: string | null;
  symbol: string;
}

/**
 * Paginated crypto historical-bars response (v1beta3 multi-symbol):
 * `bars` is keyed by symbol (e.g. "BTC/USD"), not a flat array.
 */
export interface AlpacaCryptoHistoricalBarsResponse {
  bars: Record<string, AlpacaBar[]> | null;
  next_page_token?: string | null;
}
