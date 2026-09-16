import {
  doublePrecision,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Durable scraper store — lives in the SCRAPER_DATABASE_URL database, kept
 * separate from the financial schema so stray writes can never touch trading
 * data. Written through by the Reddit / news-RSS / Twitter / StockTwits
 * tools so Viipers keeps its own archive of what the upstream sources
 * returned, and so a tool can serve a real stale read (instead of an empty
 * fallback) after the upstream API is unreachable.
 */

/** One row per scraped post/message/tweet, deduped by (source, externalId). */
export const scrapedMessages = pgTable(
  "scraped_messages",
  {
    asset: text("asset").notNull(),
    author: text("author"),
    body: text("body").notNull(),
    /** When postgres can parse the source-native id even across restarts. */
    externalId: text("external_id").notNull(),
    fetchedAt: timestamp("fetched_at").notNull().defaultNow(),
    id: uuid("id").primaryKey().defaultRandom(),
    /** "stocktwits" | "twitter" | "reddit" | "news" */
    postedAt: timestamp("posted_at"),
    /** Normalized JSON payload (fields common to every scraper tool). */
    raw: jsonb("raw").notNull(),
    /** "Bullish" | "Bearish" | null at scrape time. */
    sentimentLabel: text("sentiment_label"),
    sentimentScore: doublePrecision("sentiment_score"),
    source: text("source").notNull(),
    url: text("url"),
  },
  (t) => [
    index("scraped_messages_source_asset_posted_idx").on(
      t.source,
      t.asset,
      t.postedAt,
    ),
    uniqueIndex("scraped_messages_source_external_idx").on(
      t.source,
      t.externalId,
    ),
  ],
);

/** Durable TTL cache of a tool's composed result (exact shape as returned). */
export const scrapeCache = pgTable("scrape_cache", {
  cacheKey: text("cache_key").primaryKey(),
  expiresAt: timestamp("expires_at").notNull(),
  fetchedAt: timestamp("fetched_at").notNull().defaultNow(),
  payload: jsonb("payload").notNull(),
  source: text("source").notNull(),
});
