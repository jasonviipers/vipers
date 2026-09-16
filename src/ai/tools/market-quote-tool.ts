/**
 * Live market quote source (crypto via CoinGecko, equities via Yahoo
 * Finance). Unlike the other tools/*.ts modules, this hits real external
 * APIs, with a two-layer cache and stale-on-error fallback so a transient
 * upstream failure doesn't take down an agent mid-run.
 *
 * Cache layers: L1 = in-process Map (microseconds, per instance),
 * L2 = Redis (src/lib/redis.ts, ~ms, shared across instances and restarts)
 * when REDIS_URL is configured. A dead Redis degrades to L1-only.
 */

import { z } from "zod";
import { cacheGetJson, cacheSetJson } from "@/lib/redis";

export interface MarketQuote {
  asset: string;
  change: number;
  changePct: number;
  fetchedAt: number;
  price: number;
  source: "coingecko" | "yahoo";
  stale?: boolean;
  volume: string;
}

const cryptoIds: Record<string, string> = {
  BTC: "bitcoin",
  DOGE: "dogecoin",
  ETH: "ethereum",
  SOL: "solana",
  XRP: "ripple",
};

const cache = new Map<
  string,
  { expires: number; quote: MarketQuote; staleUntil: number }
>();
const TTL_MS = 20_000;
const TTL_SECONDS = 20;
const STALE_TTL_MS = 60_000;

/** Fresh quote from either layer; null on miss. */
async function readCache(key: string): Promise<MarketQuote | null> {
  const mem = cache.get(key);
  if (mem && mem.expires > Date.now()) {
    return mem.quote;
  }
  const shared = await cacheGetJson<MarketQuote>(`quote:${key}`);
  if (shared) {
    // Repopulate L1 so subsequent reads skip the network hop.
    cache.set(key, {
      expires: Date.now() + TTL_MS,
      quote: shared,
      staleUntil: Date.now() + STALE_TTL_MS,
    });
    return shared;
  }
  return null;
}

/** Last known quote from either layer, even if past its TTL. */
async function readStaleCache(key: string): Promise<MarketQuote | null> {
  const mem = cache.get(key);
  if (mem && mem.staleUntil > Date.now()) {
    return { ...mem.quote, stale: true };
  }
  return null;
}

async function fetchJson<T>(url: string, schema: z.ZodType<T>): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  let response: Response;
  try {
    response = await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) {
    throw new Error(`Market data request failed: ${response.status}`);
  }
  return schema.parse(await response.json());
}

const coinGeckoSchema = z.record(
  z.string(),
  z.object({
    usd: z.number().finite().positive(),
    usd_24h_change: z.number().finite().optional(),
    usd_24h_vol: z.number().finite().nonnegative().optional(),
  }),
);

const yahooChartSchema = z.object({
  chart: z.object({
    result: z
      .array(
        z.object({
          meta: z.object({
            chartPreviousClose: z.number().finite().optional(),
            regularMarketPrice: z.number().finite().positive().optional(),
          }),
        }),
      )
      .optional(),
  }),
});

async function fetchCrypto(asset: string): Promise<MarketQuote> {
  const id = cryptoIds[asset];
  if (!id) {
    throw new Error(`Unsupported crypto asset: ${asset}`);
  }
  const data = await fetchJson(
    `https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd&include_24hr_vol=true&include_24hr_change=true`,
    coinGeckoSchema,
  );
  const quote = data[id];
  if (!quote) {
    throw new Error(`No quote returned for ${asset}`);
  }
  const pct = quote.usd_24h_change ?? 0;
  const change = (quote.usd * pct) / 100;
  return {
    asset,
    change,
    changePct: pct,
    fetchedAt: Date.now(),
    price: quote.usd,
    source: "coingecko",
    volume: formatVolume(quote.usd_24h_vol ?? 0),
  };
}

async function fetchEquity(asset: string): Promise<MarketQuote> {
  const data = await fetchJson(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(asset)}?range=2d&interval=1d`,
    yahooChartSchema,
  );
  const meta = data.chart.result?.[0]?.meta;
  if (!meta?.regularMarketPrice) {
    throw new Error(`No quote returned for ${asset}`);
  }
  const previous = meta.chartPreviousClose ?? meta.regularMarketPrice;
  const change = meta.regularMarketPrice - previous;
  return {
    asset,
    change,
    changePct: previous ? (change / previous) * 100 : 0,
    fetchedAt: Date.now(),
    price: meta.regularMarketPrice,
    source: "yahoo",
    volume: "LIVE",
  };
}

function formatVolume(value: number): string {
  if (value >= 1e9) {
    return `$${(value / 1e9).toFixed(1)}B`;
  }
  if (value >= 1e6) {
    return `$${(value / 1e6).toFixed(1)}M`;
  }
  return `$${Math.round(value / 1e3)}K`;
}

export async function fetchMarketQuote(asset: string): Promise<MarketQuote> {
  const key = asset.toUpperCase();

  const cached = await readCache(key);
  if (cached) {
    return cached;
  }

  try {
    const quote = await (cryptoIds[key] ? fetchCrypto(key) : fetchEquity(key));
    cache.set(key, {
      expires: Date.now() + TTL_MS,
      quote,
      staleUntil: Date.now() + STALE_TTL_MS,
    });
    // Write-through to the shared layer; failure is a no-op.
    await cacheSetJson(`quote:${key}`, quote, TTL_SECONDS);
    return quote;
  } catch (error) {
    // Stale-on-error: serve the last known quote from either layer.
    const stale = await readStaleCache(key);
    if (stale) {
      return stale;
    }
    throw error;
  }
}

export function fetchMarketQuotes(assets: string[]): Promise<MarketQuote[]> {
  return Promise.all(assets.map(fetchMarketQuote));
}

export const DEFAULT_ASSETS = [
  "BTC",
  "ETH",
  "SOL",
  "XRP",
  "DOGE",
  "AAPL",
  "NVDA",
  "TSLA",
];

export function quoteToTicker(quote: MarketQuote) {
  return {
    asset: quote.asset,
    change: quote.change,
    changePct: quote.changePct,
    price: quote.price,
    signalScore: Math.max(-1, Math.min(1, quote.changePct / 10)),
    volume: quote.volume,
  };
}
