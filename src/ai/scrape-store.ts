import { and, desc, eq, gt, lte } from "drizzle-orm";

import { scraperDb } from "@/db/scraper-index";
import { scrapeCache, scrapedMessages } from "@/db/scraper-schema";
import { log } from "@/lib/evlog";

/**
 * Durable scraper store — the write-through / read-back surface for the
 * Reddit, news-RSS, Twitter, and StockTwits tools. Lives in the
 * SCRAPER_DATABASE_URL database (src/db/scraper-schema) so Viipers keeps its
 * own archive of every scrape, and so an unreachable upstream API can still
 * serve a real (stale-labeled) read instead of an empty fallback.
 *
 * Every function is intentionally failure-proof: a DB error is logged and
 * never propagates into the scraper tools, which must keep working with
 * in-process caches when the scraper store is unconfigured or down.
 */

export type ScrapeSource = "stocktwits" | "twitter" | "reddit" | "news";

export interface ScrapedMessageInput {
  author?: string | null;
  body: string;
  externalId: string;
  postedAt?: Date | string | null;
  sentimentLabel?: string | null;
  sentimentScore?: number | null;
  url?: string | null;
}

function db() {
  return scraperDb;
}

/** Write scraped messages, ignoring duplicates (idempotent by source). */
export async function storeScrapedMessages(
  source: ScrapeSource,
  asset: string,
  messages: ScrapedMessageInput[],
): Promise<void> {
  const database = db();
  if (!database || messages.length === 0) return;
  const rows = messages.map((m) => ({
    asset: asset.toUpperCase(),
    author: m.author ?? null,
    body: m.body,
    externalId: `${source}:${m.externalId}`,
    postedAt: m.postedAt ? new Date(m.postedAt) : null,
    raw: structuredClone({
      author: m.author,
      body: m.body,
      externalId: m.externalId,
      postedAt: m.postedAt ?? null,
      sentimentLabel: m.sentimentLabel ?? null,
      sentimentScore: m.sentimentScore ?? null,
      url: m.url ?? null,
    }),
    sentimentLabel: m.sentimentLabel ?? null,
    sentimentScore: m.sentimentScore ?? null,
    source,
    url: m.url ?? null,
  }));
  try {
    await database.insert(scrapedMessages).values(rows).onConflictDoNothing();
  } catch (error) {
    log.error(
      new Error(`scraper store write failed (${source}): ${String(error)}`),
    );
  }
}

/** Persist a tool's composed result (exact payload) with a TTL. */
export async function setScrapeCache<T>(
  key: string,
  payload: T,
  ttlMs: number,
  source: ScrapeSource,
): Promise<void> {
  const database = db();
  if (!database) return;
  const expiresAt = new Date(Date.now() + ttlMs);
  try {
    await database
      .insert(scrapeCache)
      .values({
        cacheKey: key,
        expiresAt,
        payload: structuredClone(payload) as unknown as object,
        source,
      })
      .onConflictDoUpdate({
        target: scrapeCache.cacheKey,
        set: {
          expiresAt,
          payload: structuredClone(payload) as unknown as object,
        },
      });
  } catch (error) {
    log.error(new Error(`scraper cache set failed (${key}): ${String(error)}`));
  }
}

/** Read a composed result if it has not expired. */
export async function getScrapeCache<T>(key: string): Promise<T | null> {
  const database = db();
  if (!database) return null;
  try {
    const row = await database
      .select({
        expiresAt: scrapeCache.expiresAt,
        payload: scrapeCache.payload,
      })
      .from(scrapeCache)
      .where(
        and(
          eq(scrapeCache.cacheKey, key),
          gt(scrapeCache.expiresAt, new Date()),
        ),
      )
      .limit(1);
    return (row[0]?.payload as T | undefined) ?? null;
  } catch (error) {
    log.error(new Error(`scraper cache get failed (${key}): ${String(error)}`));
    return null;
  }
}

/**
 * Stale read: a composed result regardless of expiry, or null when absent.
 * Returns the raw stored payload so tools can mark it `stale` themselves.
 */
export async function getScrapeCacheStale<T>(key: string): Promise<T | null> {
  const database = db();
  if (!database) return null;
  try {
    const row = await database
      .select({ payload: scrapeCache.payload })
      .from(scrapeCache)
      .where(lte(scrapeCache.expiresAt, new Date()))
      .orderBy(desc(scrapeCache.fetchedAt))
      .limit(1);
    return (row[0]?.payload as T | undefined) ?? null;
  } catch (error) {
    log.error(
      new Error(`scraper cache stale-get failed (${key}): ${String(error)}`),
    );
    return null;
  }
}
