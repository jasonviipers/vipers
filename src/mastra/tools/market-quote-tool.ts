/**
 * Live market quote source (crypto via CoinGecko, equities via Yahoo
 * Finance). Unlike the other tools/*.ts modules, this hits real external
 * APIs, with a short in-memory cache and stale-on-error fallback so a
 * transient upstream failure doesn't take down an agent mid-run.
 */
export interface MarketQuote {
  asset: string;
  change: number;
  changePct: number;
  price: number;
  source: "coingecko" | "yahoo";
  volume: string;
}

const cryptoIds: Record<string, string> = {
  BTC: "bitcoin",
  DOGE: "dogecoin",
  ETH: "ethereum",
  SOL: "solana",
  XRP: "ripple",
};

const cache = new Map<string, { expires: number; quote: MarketQuote }>();
const TTL = 20_000;

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Market data request failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

async function fetchCrypto(asset: string): Promise<MarketQuote> {
  const id = cryptoIds[asset];
  if (!id) {
    throw new Error(`Unsupported crypto asset: ${asset}`);
  }
  const data = await fetchJson<
    Record<
      string,
      { usd: number; usd_24h_change?: number; usd_24h_vol?: number }
    >
  >(
    `https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd&include_24hr_vol=true&include_24hr_change=true`,
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
    price: quote.usd,
    source: "coingecko",
    volume: formatVolume(quote.usd_24h_vol ?? 0),
  };
}

async function fetchEquity(asset: string): Promise<MarketQuote> {
  const data = await fetchJson<{
    chart: {
      result?: Array<{
        meta: { regularMarketPrice?: number; chartPreviousClose?: number };
      }>;
    };
  }>(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(asset)}?range=2d&interval=1d`,
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
  const cached = cache.get(key);
  if (cached && cached.expires > Date.now()) {
    return cached.quote;
  }
  try {
    const quote = await (cryptoIds[key] ? fetchCrypto(key) : fetchEquity(key));
    cache.set(key, { expires: Date.now() + TTL, quote });
    return quote;
  } catch (error) {
    const stale = cache.get(key);
    if (stale) {
      return stale.quote;
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
