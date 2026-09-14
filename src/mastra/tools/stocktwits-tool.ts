import { env } from "@/env";

/**
 * StockTwits crowd-sentiment source (SENTIMENT team).
 *
 * Reads the public per-symbol message stream from
 * `api.stocktwits.com/api/2/streams/symbol/{SYMBOL}.json`. The stream is
 * publicly readable without OAuth, but the platform now front-runs the API
 * with a Cloudflare managed challenge, so anonymous datacenter fetches are
 * frequently blocked. An optional application-level access token
 * (`STOCKTWITS_TOKEN`, passed as `access_token`) authorizes public reads and
 * is the reliable path. Without a token, failures degrade exactly like the
 * Reddit source: stale cache if available, otherwise a clearly labeled
 * neutral read in non-production, and a throw in production unless
 * `ALLOW_STUB_MARKET_DATA=true`. No invented data is ever returned.
 */

export interface StockTwitsMessage {
  body: string;
  createdAt: string;
  followers: number;
  id: number;
  likes: number;
  sentiment: "Bullish" | "Bearish" | null;
  url: string;
  username: string;
}

export interface StockTwitsSentiment {
  asset: string;
  counts: {
    bearish: number;
    bullish: number;
    unlabeled: number;
  };
  crowd: "BULLISH" | "BEARISH" | "MIXED";
  fetchedAt: number;
  highlights: string[];
  messages: StockTwitsMessage[];
  sentimentScore: number; // 0..1 (0.5 = neutral)
  socialVolume: number;
  source: "stocktwits";
  symbolId: number;
  title: string;
  totalFollowers: number;
  stale?: boolean;
}

export interface StockTwitsTrendingSymbol {
  id: number;
  symbol: string;
  title: string;
}

export interface StockTwitsTrending {
  fetchedAt: number;
  items: StockTwitsTrendingSymbol[];
  source: "stocktwits";
}

const STREAM_URL = (symbol: string) =>
  `https://api.stocktwits.com/api/2/streams/symbol/${encodeURIComponent(
    symbol,
  )}.json?limit=20`;

const TRENDING_URL =
  "https://api.stocktwits.com/api/2/trending/symbols.json?limit=10";

const TTL = 5 * 60_000;
const STALE_TTL = 60 * 60_000;

interface CacheEntry {
  expires: number;
  staleUntil: number;
  value: StockTwitsSentiment | StockTwitsTrending;
}

const cache = new Map<string, CacheEntry>();

const BASE_SYMBOL_RE = /[-/]/;

function baseSymbol(asset: string): string {
  // "BTC-USD" / "BTC/USD" -> "BTC"; keeps convention with market-signals.
  return asset.toUpperCase().split(BASE_SYMBOL_RE)[0] ?? asset.toUpperCase();
}

function fetchWithTimeout(url: string, ms = 8000): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  const token = env.STOCKTWITS_TOKEN?.trim();
  const separator = url.includes("?") ? "&" : "?";
  const signed = token
    ? `${url}${separator}access_token=${encodeURIComponent(token)}`
    : url;
  return fetch(signed, {
    headers: {
      Accept: "application/json",
      "User-Agent": "viipers-market-signals/1.0 (by @viipers)",
    },
    signal: ctrl.signal,
  }).finally(() => clearTimeout(t));
}

async function readJson<T>(url: string): Promise<T> {
  const res = await fetchWithTimeout(url);
  if (!res.ok) {
    throw new Error(
      `StockTwits request failed: ${res.status} ${res.statusText}`,
    );
  }
  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("json")) {
    // Cloudflare challenge pages are HTML; treat as a block, not data.
    throw new Error(
      `StockTwits returned ${contentType || "non-JSON"} (blocked or rate-limited)`,
    );
  }
  return (await res.json()) as T;
}

function messageFromJson(raw: Record<string, unknown>): StockTwitsMessage {
  const entities = (raw.entities as Record<string, unknown> | undefined) ?? {};
  const sentiment = entities.sentiment as { basic?: unknown } | undefined;
  const user = (raw.user as Record<string, unknown> | undefined) ?? {};
  const likes = (raw.likes as { total?: unknown } | undefined)?.total;
  const body = String(raw.body ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return {
    body: body.length > 280 ? `${body.slice(0, 277)}…` : body,
    createdAt: String(raw.created_at ?? ""),
    followers: Number(user.followers ?? 0),
    id: Number(raw.id),
    likes: Number(likes ?? 0),
    sentiment:
      sentiment?.basic === "Bullish" || sentiment?.basic === "Bearish"
        ? sentiment.basic
        : null,
    url: `https://stocktwits.com/message/${String(raw.id ?? "")}`,
    username: String(user.username ?? "?"),
  };
}

export async function fetchStockTwitsSentiment(
  asset: string,
): Promise<StockTwitsSentiment> {
  const key = `stream:${asset.toUpperCase()}`;
  const now = Date.now();
  const cached = cache.get(key);
  if (cached && cached.expires > now) {
    return cached.value as StockTwitsSentiment;
  }

  try {
    const data = await readJson<Record<string, unknown>>(
      STREAM_URL(baseSymbol(asset)),
    );
    const symbol = (data.symbol as Record<string, unknown>) ?? {};
    const rawMessages = (data.messages as Record<string, unknown>[]) ?? [];

    const messages = rawMessages.map(messageFromJson);
    const counts = { bearish: 0, bullish: 0, unlabeled: 0 };
    let totalFollowers = 0;
    for (const m of messages) {
      totalFollowers += m.followers;
      if (m.sentiment === "Bullish") {
        counts.bullish += 1;
      } else if (m.sentiment === "Bearish") {
        counts.bearish += 1;
      } else {
        counts.unlabeled += 1;
      }
    }

    const total = messages.length;
    const sentimentScore =
      total === 0 ? 0.5 : (counts.bullish + counts.unlabeled * 0.5) / total;
    const crowd: StockTwitsSentiment["crowd"] =
      total === 0
        ? "MIXED"
        : counts.bullish > counts.bearish
          ? "BULLISH"
          : counts.bearish > counts.bullish
            ? "BEARISH"
            : "MIXED";

    const highlights = [...messages]
      .sort((a, b) => b.likes - a.likes)
      .slice(0, 3)
      .map((m) => `${m.username}: ${m.body}`);

    const value: StockTwitsSentiment = {
      asset: baseSymbol(asset),
      counts,
      crowd,
      fetchedAt: now,
      highlights:
        highlights.length > 0
          ? highlights
          : [
              `[no data] No recent StockTwits messages for ${baseSymbol(asset)}`,
            ],
      messages: messages.slice(0, 10),
      sentimentScore: Number(sentimentScore.toFixed(3)),
      socialVolume: total,
      source: "stocktwits",
      symbolId: Number(symbol.id ?? 0),
      title: String(symbol.title ?? ""),
      totalFollowers,
    };

    cache.set(key, { expires: now + TTL, staleUntil: now + STALE_TTL, value });
    return value;
  } catch (error) {
    const stale = cache.get(key);
    if (stale && stale.staleUntil > now) {
      return { ...(stale.value as StockTwitsSentiment), stale: true };
    }
    if (
      env.NODE_ENV === "production" &&
      env.ALLOW_STUB_MARKET_DATA !== "true"
    ) {
      throw error;
    }
    return {
      asset: baseSymbol(asset),
      counts: { bearish: 0, bullish: 0, unlabeled: 0 },
      crowd: "MIXED",
      fetchedAt: now,
      highlights: [
        `[dev-fallback] StockTwits fetch failed for ${baseSymbol(asset)}: ${String(error)}`,
      ],
      messages: [],
      sentimentScore: 0.5,
      socialVolume: 0,
      source: "stocktwits",
      symbolId: 0,
      title: "",
      totalFollowers: 0,
    };
  }
}

export async function fetchStockTwitsTrending(): Promise<StockTwitsTrending> {
  const key = "trending";
  const now = Date.now();
  const cached = cache.get(key);
  if (cached && cached.expires > now) {
    return cached.value as StockTwitsTrending;
  }

  try {
    const data = await readJson<Record<string, unknown>>(TRENDING_URL);
    const raw = (data.symbols as Record<string, unknown>[]) ?? [];
    const items: StockTwitsTrendingSymbol[] = raw
      .map((s) => ({
        id: Number(s.id ?? 0),
        symbol: String(s.symbol ?? ""),
        title: String(s.title ?? ""),
      }))
      .filter((s) => s.symbol);

    const value: StockTwitsTrending = {
      fetchedAt: now,
      items,
      source: "stocktwits",
    };
    cache.set(key, { expires: now + TTL, staleUntil: now + STALE_TTL, value });
    return value;
  } catch (error) {
    const stale = cache.get(key);
    if (stale && stale.staleUntil > now) {
      return stale.value as StockTwitsTrending;
    }
    if (
      env.NODE_ENV === "production" &&
      env.ALLOW_STUB_MARKET_DATA !== "true"
    ) {
      throw error;
    }
    return { fetchedAt: now, items: [], source: "stocktwits" };
  }
}
