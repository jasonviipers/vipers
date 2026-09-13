import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const signalSourceEnum = pgEnum("signal_source", [
  "reddit",
  "twitter",
  "rss",
]);
export const sentimentEnum = pgEnum("sentiment", [
  "bullish",
  "bearish",
  "neutral",
]);

export const signals = pgTable(
  "signals",
  {
    asset: text("asset").notNull(),
    content: text("content").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    id: uuid("id").primaryKey().defaultRandom(),
    raw: jsonb("raw"), // original scraped payload, for audit/debugging
    score: integer("score").notNull(),
    sentiment: sentimentEnum("sentiment").notNull(),
    source: signalSourceEnum("source").notNull(),
    twitterConfirmed: boolean("twitter_confirmed").notNull().default(false),
  },
  (t) => ({
    assetTimeIdx: index("signals_asset_time_idx").on(t.asset, t.createdAt),
  }),
);
