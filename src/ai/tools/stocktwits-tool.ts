import vaderSentiment from "vader-sentiment";
import {
  getScrapeCache,
  getScrapeCacheStale,
  setScrapeCache,
  storeScrapedMessages,
} from "@/ai/scrape-store";
import { env } from "@/env";
import { APIError, StockTwitsAPI } from "./stocktwits-api";

/**
 * StockTwits crowd-sentiment source (SENTIMENT team).
 *
 * Reads per-symbol messages and trending symbols from the StockTwits
 * Whisperer API (`api.stocktwitsapi.com/v1`, `x-api-key` auth). Messages may
 * carry AI confidence scores (`sentiment_bullish` / `sentiment_bearish`,
 * 0..1) on some plans; when absent we label from the message body with the
 * same VADER scoring used by the Reddit/Twitter sources. No invented data is
 * ever returned.
 *
 * Without `STOCKTWITS_API_KEY` the tool cannot authenticate, so it degrades
 * exactly like the Reddit source: stale cache if available, otherwise a
 * clearly labeled neutral read in non-production, and a throw in production
 * unless `ALLOW_STUB_MARKET_DATA=true`.
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
  stale?: boolean;
}

const TTL = 5 * 60_000;
const STALE_TTL = 60 * 60_000;
const MESSAGE_LIMIT = 100;
const LOOKBACK_DAYS = 7;

/** compound-score thresholds that turn a VADER score into a crowd label. */
const BULLISH_COMPOUND = 0.2;
const BEARISH_COMPOUND = -0.2;

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

function client(): StockTwitsAPI | null {
  const key = env.STOCKTWITS_API_KEY?.trim();
  return key ? new StockTwitsAPI({ apiKey: key }) : null;
}

function sentimentLabel(
  bullish: number | null | undefined,
  bearish: number | null | undefined,
  body: string,
): "Bullish" | "Bearish" | null {
  // Prefer the API's AI scores when present...
  if (bullish !== null && bullish !== undefined && bullish > 0.5) {
    return "Bullish";
  }
  if (bearish !== null && bearish !== undefined && bearish > 0.5) {
    return "Bearish";
  }
  // ...otherwise fall back to VADER on the message text.
  const compound =
    vaderSentiment.SentimentIntensityAnalyzer.polarity_scores(body).compound;
  if (compound > BULLISH_COMPOUND) return "Bullish";
  if (compound < BEARISH_COMPOUND) return "Bearish";
  return null;
}

function messageFromApi(raw: {
  id: number;
  body: string;
  created_at: string;
  sentiment_bullish?: number | null;
  sentiment_bearish?: number | null;
  user?: { username?: string | null } | null;
}): StockTwitsMessage {
  const body = String(raw.body ?? "")
    .replace(/\s+/g, " ")
    .trim();
  const id = Number(raw.id ?? 0);
  return {
    body: body.length > 280 ? `${body.slice(0, 277)}…` : body,
    createdAt: String(raw.created_at ?? ""),
    followers: 0,
    id,
    likes: 0,
    sentiment: sentimentLabel(
      raw.sentiment_bullish,
      raw.sentiment_bearish,
      body,
    ),
    url: `https://stocktwits.com/message/${id}`,
    username: String(raw.user?.username ?? "?"),
  };
}

function fallbackSentiment(asset: string, note: string): StockTwitsSentiment {
  const now = Date.now();
  return {
    asset: baseSymbol(asset),
    counts: { bearish: 0, bullish: 0, unlabeled: 0 },
    crowd: "MIXED",
    fetchedAt: now,
    highlights: [note],
    messages: [],
    sentimentScore: 0.5,
    socialVolume: 0,
    source: "stocktwits",
    symbolId: 0,
    title: "",
    totalFollowers: 0,
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

  const durableCache = await getScrapeCache<StockTwitsSentiment>(key);
  if (durableCache) {
    cache.set(key, {
      expires: now + TTL,
      staleUntil: now + STALE_TTL,
      value: durableCache,
    });
    return durableCache;
  }

  const api = client();
  if (!api) {
    if (env.NODE_ENV === "production") {
      throw new APIError(
        401,
        "STOCKTWITS_API_KEY is not configured; refusing to fabricate sentiment",
        "AUTH_ERROR",
      );
    }
    const fallback = fallbackSentiment(
      asset,
      `[dev-fallback] STOCKTWITS_API_KEY not configured; StockTwits sentiment skipped for ${baseSymbol(asset)}`,
    );
    cache.set(key, {
      expires: now + TTL,
      staleUntil: now + STALE_TTL,
      value: fallback,
    });
    return fallback;
  }

  try {
    const start = new Date(
      Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();
    const data = await api.getMessages({
      symbol: baseSymbol(asset),
      start,
      limit: MESSAGE_LIMIT,
      primaryOnly: true,
      order: "desc",
    });

    const messages = data.messages.map(messageFromApi);
    const counts = { bearish: 0, bullish: 0, unlabeled: 0 };
    for (const m of messages) {
      if (m.sentiment === "Bullish") {
        counts.bullish += 1;
      } else if (m.sentiment === "Bearish") {
        counts.bearish += 1;
      } else {
        counts.unlabeled += 1;
      }
    }

    const sampled = messages.length;
    const totalMatching = data.total;
    const sentimentScore =
      sampled === 0 ? 0.5 : (counts.bullish + counts.unlabeled * 0.5) / sampled;
    const crowd: StockTwitsSentiment["crowd"] =
      sampled === 0
        ? "MIXED"
        : counts.bullish > counts.bearish
          ? "BULLISH"
          : counts.bearish > counts.bullish
            ? "BEARISH"
            : "MIXED";

    const highlights = messages
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
      socialVolume: totalMatching,
      source: "stocktwits",
      symbolId: 0,
      title: baseSymbol(asset),
      totalFollowers: 0,
    };

    cache.set(key, { expires: now + TTL, staleUntil: now + STALE_TTL, value });
    await setScrapeCache(key, value, TTL, "stocktwits");
    void storeScrapedMessages(
      "stocktwits",
      asset,
      messages.map((m) => ({
        author: m.username,
        body: m.body,
        externalId: String(m.id),
        postedAt: m.createdAt,
        sentimentLabel: m.sentiment,
        sentimentScore:
          m.sentiment === "Bullish"
            ? 0.75
            : m.sentiment === "Bearish"
              ? 0.25
              : null,
        url: m.url,
      })),
    );
    return value;
  } catch (error) {
    const stale = cache.get(key);
    if (stale && stale.staleUntil > now) {
      return { ...(stale.value as StockTwitsSentiment), stale: true };
    }
    const durableStale = await getScrapeCacheStale<StockTwitsSentiment>(key);
    if (durableStale) {
      return { ...durableStale, stale: true };
    }
    if (env.NODE_ENV === "production") {
      throw error;
    }
    return fallbackSentiment(
      asset,
      `[dev-fallback] StockTwits fetch failed for ${baseSymbol(asset)}: ${String(error)}`,
    );
  }
}

export async function fetchStockTwitsTrending(): Promise<StockTwitsTrending> {
  const key = "trending";
  const now = Date.now();
  const cached = cache.get(key);
  if (cached && cached.expires > now) {
    return cached.value as StockTwitsTrending;
  }

  const durableCache = await getScrapeCache<StockTwitsTrending>(key);
  if (durableCache) {
    cache.set(key, {
      expires: now + TTL,
      staleUntil: now + STALE_TTL,
      value: durableCache,
    });
    return durableCache;
  }

  const api = client();
  if (!api) {
    if (env.NODE_ENV === "production") {
      throw new APIError(
        401,
        "STOCKTWITS_API_KEY is not configured; refusing to fabricate trending data",
        "AUTH_ERROR",
      );
    }
    return { fetchedAt: now, items: [], source: "stocktwits" };
  }

  try {
    const data = await api.getTrending({ limit: 10 });
    const items: StockTwitsTrendingSymbol[] = data.symbols
      .map((s) => ({
        id: 0,
        symbol: String(s.symbol ?? ""),
        title: String(s.symbol ?? ""),
      }))
      .filter((s) => s.symbol);

    const value: StockTwitsTrending = {
      fetchedAt: now,
      items,
      source: "stocktwits",
    };
    cache.set(key, { expires: now + TTL, staleUntil: now + STALE_TTL, value });
    await setScrapeCache(key, value, TTL, "stocktwits");
    return value;
  } catch (error) {
    const stale = cache.get(key);
    if (stale && stale.staleUntil > now) {
      return stale.value as StockTwitsTrending;
    }
    const durableStale = await getScrapeCacheStale<StockTwitsTrending>(key);
    if (durableStale) {
      return { ...durableStale, stale: true };
    }
    if (env.NODE_ENV === "production") {
      throw error;
    }
    return { fetchedAt: now, items: [], source: "stocktwits" };
  }
}
