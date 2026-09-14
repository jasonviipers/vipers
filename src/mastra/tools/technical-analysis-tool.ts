/**
 * ANALYSIS team data source: technical indicators, market regime detection
 * and pattern analysis.
 *
 * Real implementation over the market-quote pipeline: a batch of daily
 * candles (Yahoo Finance chart endpoint for every supported asset; crypto
 * majors resolve to their USD pair) feeds RSI(14), a simple/close-price
 * moving-average trend check and an ATR-based volatility read. On any
 * upstream failure the last successful snapshot is served with `stale: true`
 * for 30 minutes — clearly labeled, never invented; with no cache in
 * production the call throws (fail closed), while non-production falls back
 * to a labeled neutral reading so local dev/test doesn't need live network.
 *
 * Patterns are derived from price action (swing high/low structure and MA
 * cross), not hardcoded strings.
 */
import { env } from "@/env";

export interface TechnicalSnapshot {
  /** Price-action observations, derived from real candles. */
  patterns: string[];
  regime: "TRENDING" | "RANGE_BOUND" | "VOLATILE";
  /** Relative Strength Index (14), 0-100. */
  rsi: number;
  /** MA-cross trend read: close above/below the 20-period SMA. */
  trend: "UP" | "DOWN" | "SIDEWAYS";
  stale?: boolean;
  /** Epoch ms when the snapshot was computed from live candles. */
  fetchedAt: number;
  /** True-price sources: Yahoo candles resolve every symbol we quote. */
  source: "yahoo";
}

const YAHOO_CHART_URL = (symbol: string) =>
  `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    symbol,
  )}?range=1mo&interval=1d`;

/** Map a project asset ("BTC-USD" / "BTC") to a charted ticker symbol. */
function chartSymbol(asset: string): string {
  const base = asset.toUpperCase().split(/[-/]/)[0] ?? asset.toUpperCase();
  return base === "BTC" ? "BTC-USD" : `${base}-USD`;
}

interface Candle {
  close: number;
  high: number;
  low: number;
  volume: number;
}

async function fetchCandles(symbol: string): Promise<Candle[]> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(YAHOO_CHART_URL(symbol), {
      headers: {
        Accept: "application/json",
        "User-Agent": "viipers-technical-analysis/1.0",
      },
      signal: ctrl.signal,
    });
    if (!res.ok) {
      throw new Error(`Yahoo chart request failed: ${res.status}`);
    }
    const json = (await res.json()) as {
      chart?: {
        result?: Array<{
          indicators?: {
            quote?: Array<{
              close?: (number | null)[];
              high?: (number | null)[];
              low?: (number | null)[];
              volume?: (number | null)[];
            }>;
          };
        }>;
      };
    };
    const quote = json.chart?.result?.[0]?.indicators?.quote?.[0];
    if (!quote?.close?.length) {
      throw new Error(`No candle data returned for ${symbol}`);
    }
    const candles: Candle[] = [];
    for (let i = 0; i < quote.close.length; i++) {
      const close = quote.close[i];
      if (close == null || close <= 0) {
        continue; // nulls on halted sessions — skip rather than fabricate
      }
      candles.push({
        close,
        high: quote.high?.[i] ?? close,
        low: quote.low?.[i] ?? close,
        volume: quote.volume?.[i] ?? 0,
      });
    }
    if (candles.length < 16) {
      throw new Error(`Insufficient candle history for ${symbol}`);
    }
    return candles;
  } finally {
    clearTimeout(timer);
  }
}

/** Wilder's RSI over the closes. Requires at least `period + 1` points. */
export function computeRsi(closes: number[], period = 14): number {
  if (closes.length < period + 1) {
    throw new Error("insufficient history for RSI");
  }
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1];
    if (change >= 0) {
      avgGain += change;
    } else {
      avgLoss -= change;
    }
  }
  avgGain /= period;
  avgLoss /= period;
  // Smooth the remainder of the series (Wilder's smoothing).
  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(change, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-change, 0)) / period;
  }
  if (avgLoss === 0) {
    // All-gain series is max strength; a truly flat series (zero gain AND
    // zero loss) has no information and reads neutral, not overheated.
    return avgGain > 0 ? 100 : 50;
  }
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/** Simple moving average of the last `period` closes. */
export function computeSma(closes: number[], period: number): number {
  if (closes.length < period) {
    throw new Error("insufficient history for SMA");
  }
  const window = closes.slice(-period);
  return window.reduce((a, b) => a + b, 0) / period;
}

/** Average True Range — a volatility magnitude in price units. */
export function computeAtr(candles: Candle[], period = 14): number {
  if (candles.length < period + 1) {
    throw new Error("insufficient history for ATR");
  }
  let atr = 0;
  for (let i = 1; i <= period; i++) {
    const prevClose = candles[i - 1].close;
    const { high, low } = candles[i];
    atr += Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose),
    );
  }
  atr /= period;
  for (let i = period + 1; i < candles.length; i++) {
    const prevClose = candles[i - 1].close;
    const { high, low } = candles[i];
    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose),
    );
    atr = (atr * (period - 1) + tr) / period;
  }
  return atr;
}

/**
 * Swing-structure read: compare the two most recent swing highs/lows to
 * characterize the trend as higher-lows/higher-highs or the reverse.
 */
function swingPatterns(candles: Candle[]): string[] {
  const patterns: string[] = [];
  const highs = candles.map((c, i) => ({ i, v: c.high }));
  const lows = candles.map((c, i) => ({ i, v: c.low }));
  const swingHighs = highs.filter(
    (h, i) =>
      i > 0 &&
      i < highs.length - 1 &&
      h.v > highs[i - 1].v &&
      h.v > highs[i + 1].v,
  );
  const swingLows = lows.filter(
    (l, i) =>
      i > 0 &&
      i < lows.length - 1 &&
      l.v < lows[i - 1].v &&
      l.v < lows[i + 1].v,
  );
  const lastTwoHighs = swingHighs.slice(-2);
  const lastTwoLows = swingLows.slice(-2);
  if (lastTwoLows.length === 2) {
    patterns.push(
      lastTwoLows[1].v > lastTwoLows[0].v
        ? "higher lows structure"
        : "lower lows structure",
    );
  }
  if (lastTwoHighs.length === 2) {
    patterns.push(
      lastTwoHighs[1].v > lastTwoHighs[0].v
        ? "higher highs structure"
        : "lower highs structure",
    );
  }
  return patterns;
}

const TTL = 5 * 60_000;
const STALE_TTL = 30 * 60_000;
const cache = new Map<
  string,
  { expires: number; snapshot: TechnicalSnapshot; staleUntil: number }
>();

function neutralSnapshot(now: number): TechnicalSnapshot {
  return {
    fetchedAt: now,
    patterns: ["[dev-fallback] insufficient data for pattern analysis"],
    regime: "RANGE_BOUND",
    rsi: 50,
    source: "yahoo",
    trend: "SIDEWAYS",
  };
}

export async function fetchTechnicals(
  asset: string,
): Promise<TechnicalSnapshot> {
  const key = asset.toUpperCase();
  const now = Date.now();
  const cached = cache.get(key);
  if (cached && cached.expires > now) {
    return cached.snapshot;
  }

  try {
    const candles = await fetchCandles(chartSymbol(key));
    const closes = candles.map((c) => c.close);
    const last = closes[closes.length - 1];
    const sma20 = computeSma(closes, 20);
    const rsi = computeRsi(closes);
    const atr = computeAtr(candles);

    // Trend: close relative to the 20-SMA. SIDEWAYS when within one ATR.
    const distance = last - sma20;
    const trend: TechnicalSnapshot["trend"] =
      Math.abs(distance) <= atr ? "SIDEWAYS" : distance > 0 ? "UP" : "DOWN";

    // Regime: ATR as a fraction of price drives VOLATILE; a flat SMA with
    // oscillating closes reads RANGE_BOUND; otherwise TRENDING.
    const atrPct = atr / last;
    const smaDrift =
      Math.abs(computeSma(closes.slice(0, -10), 20) - sma20) / sma20;
    const regime: TechnicalSnapshot["regime"] =
      atrPct > 0.06
        ? "VOLATILE"
        : smaDrift < 0.005 && Math.abs(distance) / atr < 0.5
          ? "RANGE_BOUND"
          : "TRENDING";

    const patterns = swingPatterns(candles);
    const snapshot: TechnicalSnapshot = {
      fetchedAt: now,
      patterns:
        patterns.length > 0
          ? patterns
          : ["no decisive swing structure in the review window"],
      regime,
      rsi: Number(rsi.toFixed(2)),
      source: "yahoo",
      trend,
    };

    cache.set(key, {
      expires: now + TTL,
      snapshot,
      staleUntil: now + STALE_TTL,
    });
    return snapshot;
  } catch (error) {
    const stale = cache.get(key);
    if (stale && stale.staleUntil > now) {
      return { ...stale.snapshot, stale: true };
    }
    if (env.NODE_ENV === "production") {
      throw error;
    }
    return neutralSnapshot(now);
  }
}
