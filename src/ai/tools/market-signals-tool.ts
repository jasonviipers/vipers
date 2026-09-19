import { XMLParser } from "fast-xml-parser";
import vaderSentiment from "vader-sentiment";
import {
  getScrapeCache,
  getScrapeCacheStale,
  setScrapeCache,
  storeScrapedMessages,
} from "@/ai/scrape-store";
import { env } from "@/env";
import { log } from "@/lib/evlog";

/**
 * SENTIMENT team data source: Reddit + RSS news, scored with VADER.
 *
 * This replaces the earlier deterministic (asset.length-based) stub. Failures
 * fall back to a short-lived stale cache; with no stale cache in production,
 * it throws rather than silently trading on invented data. In non-production
 * environments with no cache and no network, it falls back to a clearly
 * labeled neutral reading so local dev/test doesn't require live Reddit/RSS
 * access.
 */
export interface MarketSignals {
  asset: string;
  breakdown: {
    redditScore: number;
    rssScore: number;
  };
  fetchedAt: number;
  highlights: string[];
  sentimentScore: number; // 0..1 (0.5 = neutral)
  socialVolume: number; // total posts + articles analyzed
  sources: {
    reddit: number;
    rss: number;
  };
  stale?: boolean;
}

const SUBREDDITS = [
  "CryptoCurrency",
  "Bitcoin",
  "ethereum",
  "solana",
  "wallstreetbets",
  "stocks",
];

const RSS_FEEDS: { url: string; label: string }[] = [
  { label: "CoinTelegraph", url: "https://cointelegraph.com/rss" },
  {
    label: "CoinDesk",
    url: "https://www.coindesk.com/arc/outboundfeeds/rss/",
  },
  { label: "Decrypt", url: "https://decrypt.co/feed" },
  { label: "BitcoinMag", url: "https://bitcoinmagazine.com/feed" },
  { label: "Investing.com", url: "https://www.investing.com/rss/news.rss" },
];

// Friendly-name mapping for search relevance. Keyed by the BASE symbol
// (e.g. "BTC"), since callers may pass "BTC-USD" style pairs matching the
// convention used in contracts.ts / config.ts.
const ASSET_NAMES: Record<string, string[]> = {
  AAPL: ["apple"],
  BTC: ["bitcoin", "btc"],
  DOGE: ["dogecoin", "doge"],
  ETH: ["ethereum", "eth", "ether"],
  GOOGL: ["google", "alphabet"],
  MSFT: ["microsoft"],
  NVDA: ["nvidia"],
  SOL: ["solana", "sol"],
  TSLA: ["tesla"],
  XRP: ["ripple", "xrp"],
};

const TTL = 5 * 60_000;
const STALE_TTL = 60 * 60_000;
const cache = new Map<
  string,
  { expires: number; staleUntil: number; signals: MarketSignals }
>();

const xml = new XMLParser({ ignoreAttributes: false, trimValues: true });

const BASE_SYMBOL_RE = /[-/]/;

function baseSymbol(asset: string): string {
  // "BTC-USD" / "BTC/USD" -> "BTC"; contracts.ts documents assets this way,
  // so without this split, every crypto pair misses ASSET_NAMES and falls
  // back to searching for the literal string "btc-usd".
  return asset.toUpperCase().split(BASE_SYMBOL_RE)[0] ?? asset.toUpperCase();
}

function assetTerms(asset: string): string[] {
  const key = baseSymbol(asset);
  return ASSET_NAMES[key] ?? [key.toLowerCase()];
}

function mentionsAsset(text: string, terms: string[]): boolean {
  const lower = text.toLowerCase();
  return terms.some((t) => lower.includes(t));
}

function scoreText(text: string): number {
  // Real API: vader.SentimentIntensityAnalyzer.polarity_scores(text).
  // (Previously called as Sentiment.analyze(text), which doesn't exist on
  // this package and throws at runtime.)
  const { compound } =
    vaderSentiment.SentimentIntensityAnalyzer.polarity_scores(text);
  return compound;
}

function averageToUnit(nums: number[]): number {
  if (nums.length === 0) {
    return 0.5;
  }
  const avg = nums.reduce((a, b) => a + b, 0) / nums.length;
  return Number(((avg + 1) / 2).toFixed(3));
}

// ── Reddit OAuth (app-only / "script" app) ─────────────────────────────
//
// The public www.reddit.com .json endpoints are blocked for many server
// network identities (403 HTML interstitial; confirmed 2026-09-19). Reddit's
// OAuth API at oauth.reddit.com serves the SAME listings/search payloads
// and honors app-only Basic auth — when REDDIT_CLIENT_ID/REDDIT_CLIENT_SECRET
// are configured (a "script" app from https://www.reddit.com/prefs/apps),
// fetches go there instead.

const REDDIT_TOKEN_URL = "https://www.reddit.com/api/v1/access_token";

let redditTokenCache: { accessToken: string; expiresAtMs: number } | null =
  null;

function isRedditOAuthConfigured(): boolean {
  return Boolean(
    env.REDDIT_CLIENT_ID?.trim() && env.REDDIT_CLIENT_SECRET?.trim(),
  );
}

/**
 * Fetch (and cache until ~1h before expiry) an app-only access token via
 * the client_credentials grant with HTTP Basic auth. Token responses are
 * JSON: { access_token, token_type, expires_in, ... }.
 */
async function getRedditAccessToken(): Promise<string> {
  const now = Date.now();
  if (redditTokenCache && redditTokenCache.expiresAtMs > now + 60_000) {
    return redditTokenCache.accessToken;
  }
  const basic = Buffer.from(
    `${env.REDDIT_CLIENT_ID?.trim()}:${env.REDDIT_CLIENT_SECRET?.trim()}`,
  ).toString("base64");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  let res: Response;
  try {
    res = await fetch(REDDIT_TOKEN_URL, {
      body: "grant_type=client_credentials",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "viipers-market-signals/1.0",
      },
      method: "POST",
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    throw new Error(`Reddit token request failed: ${res.status}`);
  }
  const payload = (await res.json()) as {
    access_token?: string;
    expires_in?: number;
  };
  if (!payload.access_token) {
    throw new Error("Reddit token response carried no access_token");
  }
  const ttlMs = (payload.expires_in ?? 3600) * 1000;
  redditTokenCache = {
    accessToken: payload.access_token,
    expiresAtMs: now + ttlMs,
  };
  return payload.access_token;
}

async function fetchWithTimeout(url: string, ms = 8000): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, {
      headers: {
        Accept:
          "application/json, application/rss+xml, application/xml, text/xml, */*",
        "User-Agent": "viipers-market-signals/1.0 (by /u/viipers)",
      },
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(t);
  }
}

interface RedditPost {
  num_comments?: number;
  permalink?: string;
  score?: number;
  selftext?: string;
  subreddit?: string;
  title: string;
}

async function fetchRedditPosts(
  asset: string,
  limitPerSub = 20,
): Promise<RedditPost[]> {
  const terms = assetTerms(asset);
  const query = terms[0] ?? baseSymbol(asset).toLowerCase();
  const out: RedditPost[] = [];
  let blocked = 0;
  const useOAuth = isRedditOAuthConfigured();

  // The OAuth token is fetched ONCE per pass (not per subreddit) — the
  // client_credentials grant is rate-limited too.
  let bearer: string | null = null;
  if (useOAuth) {
    try {
      bearer = await getRedditAccessToken();
    } catch (error) {
      log.warn({
        job: "market-signals",
        source: "reddit",
        warning: `reddit OAuth token fetch failed, falling back to public endpoints: ${String(error)}`,
      });
    }
  }

  await Promise.all(
    SUBREDDITS.map(async (sub) => {
      // oauth.reddit.com serves the same .json payloads under the same
      // query semantics (restrict_sr etc.) with a Bearer token.
      const url =
        (bearer
          ? `https://oauth.reddit.com/r/${sub}/search.json`
          : `https://www.reddit.com/r/${sub}/search.json`) +
        `?q=${encodeURIComponent(query)}&restrict_sr=1&sort=relevance&t=week&limit=${limitPerSub}`;
      try {
        const res = bearer
          ? await fetch(url, {
              headers: {
                Accept: "application/json",
                Authorization: `Bearer ${bearer}`,
                "User-Agent": "viipers-market-signals/1.0",
              },
              signal: AbortSignal.timeout(8000),
            })
          : await fetchWithTimeout(url);
        if (!res.ok) {
          blocked += 1;
          return;
        }
        // Reddit's block interstitial is served as HTML; parsing it as JSON
        // would throw and be swallowed below — count it as a block instead.
        if (!(res.headers.get("content-type") ?? "").includes("json")) {
          blocked += 1;
          return;
        }
        const json = (await res.json()) as {
          data?: { children?: { data: RedditPost }[] };
        };
        const children = json.data?.children ?? [];
        for (const c of children) {
          const p = c.data;
          if (!p?.title) {
            continue;
          }
          const blob = `${p.title} ${p.selftext ?? ""}`;
          if (mentionsAsset(blob, terms)) {
            out.push(p);
          }
        }
      } catch {
        blocked += 1;
      }
    }),
  );

  // When the public endpoints are fully blocked and no OAuth fallback
  // exists (or it also failed), warn so the "reddit silently dark" state is
  // observable in logs rather than an empty archive nobody can explain.
  if (blocked > 0 && out.length === 0) {
    log.warn({
      blockedSubreddits: blocked,
      job: "market-signals",
      oauthAttempted: useOAuth,
      source: "reddit",
      totalSubreddits: SUBREDDITS.length,
      warning: bearer
        ? "reddit OAuth fetch failed — archive gets no reddit rows"
        : "reddit public JSON blocked — archive gets no reddit rows",
    });
  }

  return out;
}

interface RssItem {
  description?: string;
  link?: string;
  title: string;
}

async function fetchRssItems(
  asset: string,
): Promise<{ items: RssItem[]; feedCount: number }> {
  const terms = assetTerms(asset);
  const items: RssItem[] = [];
  let feedCount = 0;

  await Promise.all(
    RSS_FEEDS.map(async (feed) => {
      try {
        const res = await fetchWithTimeout(feed.url);
        if (!res.ok) {
          return;
        }
        const text = await res.text();
        const parsed = xml.parse(text);
        const channel =
          parsed?.rss?.channel ??
          parsed?.feed ??
          parsed?.["rdf:RDF"]?.channel ??
          null;
        if (!channel) {
          return;
        }

        feedCount += 1;
        const rawItems = channel.item ?? channel.entry ?? [];
        const list = Array.isArray(rawItems) ? rawItems : [rawItems];

        for (const it of list) {
          const title =
            typeof it.title === "string"
              ? it.title
              : (it.title?.["#text"] ?? "");
          const desc =
            typeof it.description === "string"
              ? it.description
              : (it.summary?.["#text"] ?? it.summary ?? "");
          const link =
            typeof it.link === "string" ? it.link : (it.link?.["@_href"] ?? "");
          if (!title) {
            continue;
          }
          const blob = `${title} ${desc}`;
          if (mentionsAsset(blob, terms)) {
            items.push({ description: desc, link, title });
          }
        }
      } catch {
        // Swallow per-feed failures; other feeds still contribute.
      }
    }),
  );

  return { feedCount, items };
}

export async function fetchMarketSignals(
  asset: string,
): Promise<MarketSignals> {
  const key = asset.toUpperCase();
  const now = Date.now();
  const cached = cache.get(key);

  if (cached && cached.expires > now) {
    return cached.signals;
  }

  const durableCache = await getScrapeCache<MarketSignals>(`mkt:${key}`);
  if (durableCache) {
    cache.set(key, {
      expires: now + TTL,
      signals: durableCache,
      staleUntil: now + STALE_TTL,
    });
    return durableCache;
  }

  try {
    const [redditPosts, rss] = await Promise.all([
      fetchRedditPosts(key),
      fetchRssItems(key),
    ]);

    const redditScores = redditPosts.map((p) =>
      scoreText(`${p.title} ${p.selftext ?? ""}`),
    );
    const redditScore = averageToUnit(redditScores);

    const rssScores = rss.items.map((i) =>
      scoreText(`${i.title} ${i.description ?? ""}`),
    );
    const rssScore = averageToUnit(rssScores);

    const total = redditPosts.length + rss.items.length;
    const combined =
      total === 0
        ? 0.5
        : (redditScore * redditPosts.length + rssScore * rss.items.length) /
          total;

    const highlightCandidates: { text: string; weight: number }[] = [];
    for (const p of redditPosts.slice(0, 10)) {
      const s = Math.abs(scoreText(`${p.title} ${p.selftext ?? ""}`));
      highlightCandidates.push({
        text: p.title.length > 120 ? `${p.title.slice(0, 117)}…` : p.title,
        weight: s + (p.score ?? 0) / 1000,
      });
    }
    for (const i of rss.items.slice(0, 10)) {
      const s = Math.abs(scoreText(`${i.title} ${i.description ?? ""}`));
      highlightCandidates.push({
        text: i.title.length > 120 ? `${i.title.slice(0, 117)}…` : i.title,
        weight: s,
      });
    }

    const highlights = highlightCandidates
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 3)
      .map((h) => h.text);

    const signals: MarketSignals = {
      asset: key,
      breakdown: { redditScore, rssScore },
      fetchedAt: now,
      highlights:
        highlights.length > 0
          ? highlights
          : [`[no data] No recent Reddit/RSS items for ${key}`],
      sentimentScore: Number(combined.toFixed(3)),
      socialVolume: total,
      sources: { reddit: redditPosts.length, rss: rss.items.length },
    };

    cache.set(key, {
      expires: now + TTL,
      signals,
      staleUntil: now + STALE_TTL,
    });
    await setScrapeCache(`mkt:${key}`, signals, TTL, "reddit");
    void storeScrapedMessages(
      "reddit",
      key,
      redditPosts.map((p) => ({
        author: p.subreddit ? `r/${p.subreddit}` : null,
        body: p.title,
        externalId: `mkt:${p.permalink ?? p.title}`,
        sentimentScore: (p.score ?? 0) / 1000,
        url: p.permalink ? `https://reddit.com${p.permalink}` : null,
      })),
    );
    void storeScrapedMessages(
      "news",
      key,
      rss.items.map((i) => ({
        body: i.title,
        externalId: `mkt:${i.link ?? i.title}`,
        url: i.link,
      })),
    );
    return signals;
  } catch (error) {
    const stale = cache.get(key);
    if (stale && stale.staleUntil > now) {
      return { ...stale.signals, stale: true };
    }
    const durableStale = await getScrapeCacheStale<MarketSignals>(`mkt:${key}`);
    if (durableStale) {
      return { ...durableStale, stale: true };
    }
    // No cache to fall back on. In production, fail closed rather than
    // trade on invented data. Outside production, degrade to a clearly
    // labeled neutral reading so local dev/test doesn't need live network.
    if (env.NODE_ENV === "production") {
      throw error;
    }
    return {
      asset: key,
      breakdown: { redditScore: 0.5, rssScore: 0.5 },
      fetchedAt: now,
      highlights: [
        `[dev-fallback] Live fetch failed for ${key}: ${String(error)}`,
      ],
      sentimentScore: 0.5,
      socialVolume: 0,
      sources: { reddit: 0, rss: 0 },
    };
  }
}

// ---------------------------------------------------------------------------
// Per-source scraping: `scrapeReddit` and `scrapeNews` surface one source at
// a time so agents can ask for "any" channel directly instead of only the
// combined read. Each keeps its own TTL cache and the same degradation
// contract as the combined function (stale cache → labeled dev fallback in
// non-production → throw in production). No source ever fabricates data.
// ---------------------------------------------------------------------------

export interface SourceSentimentSignal {
  asset: string;
  fetchedAt: number;
  highlights: string[];
  sentimentScore: number; // 0..1 (0.5 = neutral)
  socialVolume: number;
  source: "reddit" | "news";
  /** Per-source entry counts; the untouched source is 0 (honest — not read). */
  sources: { reddit: number; rss: number };
  stale?: boolean;
}

const REDDIT_CACHE = new Map<
  string,
  { expires: number; signal: SourceSentimentSignal; staleUntil: number }
>();
const NEWS_CACHE = new Map<
  string,
  { expires: number; signal: SourceSentimentSignal; staleUntil: number }
>();

const REDDIT_TTL = 5 * 60_000;
const REDDIT_STALE_TTL = 60 * 60_000;
const NEWS_TTL = 5 * 60_000;
const NEWS_STALE_TTL = 60 * 60_000;

function redditHighlights(posts: RedditPost[]): string[] {
  const candidates = posts.slice(0, 10).map((p) => ({
    text: p.title.length > 120 ? `${p.title.slice(0, 117)}…` : p.title,
    weight:
      Math.abs(scoreText(`${p.title} ${p.selftext ?? ""}`)) +
      (p.score ?? 0) / 1000,
  }));
  return candidates
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 3)
    .map((h) => h.text);
}

function newsHighlights(items: RssItem[]): string[] {
  const candidates = items.slice(0, 10).map((i) => ({
    text: i.title.length > 120 ? `${i.title.slice(0, 117)}…` : i.title,
    weight: Math.abs(scoreText(`${i.title} ${i.description ?? ""}`)),
  }));
  return candidates
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 3)
    .map((h) => h.text);
}

/** Reddit-only sentiment for an asset (posts searched against SUBREDDITS). */
export async function fetchRedditSignals(
  asset: string,
): Promise<SourceSentimentSignal> {
  const key = `reddit:${asset.toUpperCase()}`;
  const now = Date.now();
  const cached = REDDIT_CACHE.get(key);
  if (cached && cached.expires > now) {
    return cached.signal;
  }

  const durableCache = await getScrapeCache<SourceSentimentSignal>(key);
  if (durableCache) {
    REDDIT_CACHE.set(key, {
      expires: now + REDDIT_TTL,
      signal: durableCache,
      staleUntil: now + REDDIT_STALE_TTL,
    });
    return durableCache;
  }

  try {
    const posts = await fetchRedditPosts(asset);
    const scores = posts.map((p) =>
      scoreText(`${p.title} ${p.selftext ?? ""}`),
    );
    const highlights = redditHighlights(posts);

    const signal: SourceSentimentSignal = {
      asset: asset.toUpperCase(),
      fetchedAt: now,
      highlights:
        highlights.length > 0
          ? highlights
          : [`[no data] No recent Reddit mentions of ${asset.toUpperCase()}`],
      sentimentScore: Number(averageToUnit(scores).toFixed(3)),
      socialVolume: posts.length,
      source: "reddit",
      sources: { reddit: posts.length, rss: 0 },
    };

    REDDIT_CACHE.set(key, {
      expires: now + REDDIT_TTL,
      signal,
      staleUntil: now + REDDIT_STALE_TTL,
    });
    await setScrapeCache(key, signal, REDDIT_TTL, "reddit");
    void storeScrapedMessages(
      "reddit",
      asset,
      posts.map((p) => ({
        author: p.subreddit ? `r/${p.subreddit}` : null,
        body: p.title,
        externalId: p.permalink ?? p.title,
        url: p.permalink ? `https://reddit.com${p.permalink}` : null,
      })),
    );
    return signal;
  } catch (error) {
    const stale = REDDIT_CACHE.get(key);
    if (stale && stale.staleUntil > now) {
      return { ...stale.signal, stale: true };
    }
    const durableStale = await getScrapeCacheStale<SourceSentimentSignal>(key);
    if (durableStale) {
      return { ...durableStale, stale: true };
    }
    if (env.NODE_ENV === "production") {
      throw error;
    }
    return {
      asset: asset.toUpperCase(),
      fetchedAt: now,
      highlights: [
        `[dev-fallback] Reddit fetch failed for ${asset.toUpperCase()}: ${String(error)}`,
      ],
      sentimentScore: 0.5,
      socialVolume: 0,
      source: "reddit",
      sources: { reddit: 0, rss: 0 },
    };
  }
}

/** News/RSS-only sentiment for an asset (headline feeds listed in RSS_FEEDS). */
export async function fetchNewsSignals(
  asset: string,
): Promise<SourceSentimentSignal> {
  const key = `news:${asset.toUpperCase()}`;
  const now = Date.now();
  const cached = NEWS_CACHE.get(key);
  if (cached && cached.expires > now) {
    return cached.signal;
  }

  const durableCache = await getScrapeCache<SourceSentimentSignal>(key);
  if (durableCache) {
    NEWS_CACHE.set(key, {
      expires: now + NEWS_TTL,
      signal: durableCache,
      staleUntil: now + NEWS_STALE_TTL,
    });
    return durableCache;
  }

  try {
    const { items } = await fetchRssItems(asset);
    const scores = items.map((i) =>
      scoreText(`${i.title} ${i.description ?? ""}`),
    );
    const highlights = newsHighlights(items);

    const signal: SourceSentimentSignal = {
      asset: asset.toUpperCase(),
      fetchedAt: now,
      highlights:
        highlights.length > 0
          ? highlights
          : [
              `[no data] No recent news headlines mentioning ${asset.toUpperCase()}`,
            ],
      sentimentScore: Number(averageToUnit(scores).toFixed(3)),
      socialVolume: items.length,
      source: "news",
      sources: { reddit: 0, rss: items.length },
    };

    NEWS_CACHE.set(key, {
      expires: now + NEWS_TTL,
      signal,
      staleUntil: now + NEWS_STALE_TTL,
    });
    await setScrapeCache(key, signal, NEWS_TTL, "news");
    void storeScrapedMessages(
      "news",
      asset,
      items.map((i) => ({
        body: i.title,
        externalId: i.link ?? i.title,
        url: i.link,
      })),
    );
    return signal;
  } catch (error) {
    const stale = NEWS_CACHE.get(key);
    if (stale && stale.staleUntil > now) {
      return { ...stale.signal, stale: true };
    }
    const durableStale = await getScrapeCacheStale<SourceSentimentSignal>(key);
    if (durableStale) {
      return { ...durableStale, stale: true };
    }
    if (env.NODE_ENV === "production") {
      throw error;
    }
    return {
      asset: asset.toUpperCase(),
      fetchedAt: now,
      highlights: [
        `[dev-fallback] News fetch failed for ${asset.toUpperCase()}: ${String(error)}`,
      ],
      sentimentScore: 0.5,
      socialVolume: 0,
      source: "news",
      sources: { reddit: 0, rss: 0 },
    };
  }
}
