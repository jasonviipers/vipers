import vaderSentiment from "vader-sentiment";
import {
  getScrapeCache,
  getScrapeCacheStale,
  setScrapeCache,
  storeScrapedMessages,
} from "@/ai/scrape-store";
import { env } from "@/env";

/**
 * Twitter/X mention scraper (SENTIMENT team).
 *
 * Reads real tweets for an asset via the X API v2 `tweets/search/recent`
 * endpoint, which requires an app-level Bearer token (`TWITTER_BEARER_TOKEN`).
 * Search/recent covers the rolling ~7-day window and includes organic
 * retweets unless excluded — we query `-is:retweet` and score the tweet text
 * with VADER exactly like the Reddit/news sources so scores are comparable.
 *
 * Unconfigured is an honest state, not a failure: with no token the tool
 * returns `unconfigured: true` and zero mentions — it never invents tweets or
 * fabricates a neutral score to look busy. With a token, network failures
 * degrade like the other sources: stale cache → labeled dev fallback in
 * non-production → throw in production.
 */

export interface TwitterMention {
  authorId: string;
  authorUsername: string;
  createdAt: string;
  id: string;
  likeCount: number;
  retweetCount: number;
  text: string;
  url: string;
}

export interface TwitterSentiment {
  asset: string;
  detail?: string;
  fetchedAt: number;
  highlights: string[];
  mentions: TwitterMention[];
  sentimentScore: number; // 0..1 (0.5 = neutral)
  socialVolume: number;
  source: "twitter";
  stale?: boolean;
  unconfigured?: boolean;
}

const SEARCH_URL = "https://api.twitter.com/2/tweets/search/recent";

const TTL = 5 * 60_000;
const STALE_TTL = 30 * 60_000;

interface CacheEntry {
  expires: number;
  staleUntil: number;
  value: TwitterSentiment;
}

const cache = new Map<string, CacheEntry>();

const BASE_SYMBOL_RE = /[-/]/;

function baseSymbol(asset: string): string {
  return asset.toUpperCase().split(BASE_SYMBOL_RE)[0] ?? asset.toUpperCase();
}

function unconfiguredResult(asset: string, now: number): TwitterSentiment {
  return {
    asset,
    detail:
      "Twitter/X scraping requires TWITTER_BEARER_TOKEN (X API v2 tweets/search/recent). Unconfigured — no tweet data was fetched or invented.",
    fetchedAt: now,
    highlights: [
      "[unconfigured] Twitter/X scraping is not configured; set TWITTER_BEARER_TOKEN to enable tweet sentiment",
    ],
    mentions: [],
    sentimentScore: 0.5,
    socialVolume: 0,
    source: "twitter",
    unconfigured: true,
  };
}

function devFallbackResult(
  asset: string,
  now: number,
  error: unknown,
): TwitterSentiment {
  return {
    asset,
    detail: `Twitter fetch failed: ${String(error)}`,
    fetchedAt: now,
    highlights: [
      `[dev-fallback] Twitter fetch failed for ${asset}: ${String(error)}`,
    ],
    mentions: [],
    sentimentScore: 0.5,
    socialVolume: 0,
    source: "twitter",
  };
}

function mentionFromTweet(
  tweet: Record<string, unknown>,
  usernames: Map<string, string>,
): TwitterMention {
  const id = String(tweet.id ?? "");
  const authorId = String(tweet.author_id ?? "");
  const metrics = (tweet.public_metrics as Record<string, unknown>) ?? {};
  const text = String(tweet.text ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return {
    authorId,
    authorUsername: usernames.get(authorId) ?? "?",
    createdAt: String(tweet.created_at ?? ""),
    id,
    likeCount: Number(metrics.like_count ?? 0),
    retweetCount: Number(metrics.retweet_count ?? 0),
    text: text.length > 280 ? `${text.slice(0, 277)}…` : text,
    url: `https://x.com/i/web/status/${id}`,
  };
}

export async function fetchTwitterSentiment(
  asset: string,
): Promise<TwitterSentiment> {
  const symbol = baseSymbol(asset);
  const now = Date.now();

  if (!env.TWITTER_BEARER_TOKEN?.trim()) {
    return unconfiguredResult(symbol, now);
  }

  const key = `twitter:${symbol}`;
  const cached = cache.get(key);
  if (cached && cached.expires > now) {
    return cached.value;
  }

  const durableCache = await getScrapeCache<TwitterSentiment>(key);
  if (durableCache) {
    cache.set(key, {
      expires: now + TTL,
      staleUntil: now + STALE_TTL,
      value: durableCache,
    });
    return durableCache;
  }

  try {
    const query = `(${symbol}) -is:retweet lang:en`;
    const params = new URLSearchParams({
      query,
      "tweet.fields": "created_at,public_metrics,author_id",
      expansions: "author_id",
      "user.fields": "username",
      max_results: "20",
    });
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10_000);
    let res: Response;
    try {
      res = await fetch(`${SEARCH_URL}?${params.toString()}`, {
        headers: {
          Authorization: `Bearer ${env.TWITTER_BEARER_TOKEN.trim()}`,
          "User-Agent": "viipers-market-signals/1.0",
        },
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      throw new Error(`Twitter search failed: ${res.status} ${res.statusText}`);
    }
    const data = (await res.json()) as {
      data?: Record<string, unknown>[];
      includes?: {
        users?: { id?: string; username?: string }[];
      };
    };

    const usernames = new Map<string, string>();
    for (const user of data.includes?.users ?? []) {
      if (user.id) {
        usernames.set(user.id, user.username ?? "?");
      }
    }

    const mentions = (data.data ?? [])
      .map((t) => mentionFromTweet(t, usernames))
      .filter((m) => m.id);

    const scores = mentions.map(
      (m) =>
        vaderSentiment.SentimentIntensityAnalyzer.polarity_scores(m.text)
          .compound,
    );
    const sentimentScore = Number(
      averageToUnit(scores.length === 0 ? [] : scores).toFixed(3),
    );
    const highlights = [...mentions]
      .sort(
        (a, b) => b.likeCount + b.retweetCount - (a.likeCount + a.retweetCount),
      )
      .slice(0, 3)
      .map((m) => `@${m.authorUsername}: ${m.text}`);

    const value: TwitterSentiment = {
      asset: symbol,
      fetchedAt: now,
      highlights:
        highlights.length > 0
          ? highlights
          : [`[no data] No recent tweets matching ${symbol}`],
      mentions,
      sentimentScore,
      socialVolume: mentions.length,
      source: "twitter",
    };

    cache.set(key, { expires: now + TTL, staleUntil: now + STALE_TTL, value });
    await setScrapeCache(key, value, TTL, "twitter");
    void storeScrapedMessages(
      "twitter",
      symbol,
      mentions.map((m) => ({
        author: m.authorUsername,
        body: m.text,
        externalId: m.id,
        postedAt: m.createdAt,
        url: m.url,
      })),
    );
    return value;
  } catch (error) {
    const stale = cache.get(key);
    if (stale && stale.staleUntil > now) {
      return { ...stale.value, stale: true };
    }
    const durableStale = await getScrapeCacheStale<TwitterSentiment>(key);
    if (durableStale) {
      return { ...durableStale, stale: true };
    }
    if (env.NODE_ENV === "production") {
      throw error;
    }
    return devFallbackResult(symbol, now, error);
  }
}

function averageToUnit(nums: number[]): number {
  if (nums.length === 0) {
    return 0.5;
  }
  const avg = nums.reduce((a, b) => a + b, 0) / nums.length;
  return Number(((avg + 1) / 2).toFixed(3));
}
