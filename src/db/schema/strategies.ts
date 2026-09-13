import {
  boolean,
  integer,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { signalSourceEnum } from "./signals";

export const strategyTypeEnum = pgEnum("strategy_type", [
  "MOMENTUM",
  "SENTIMENT_ONLY",
  "MEAN_REVERSION",
]);
export const llmProviderEnum = pgEnum("llm_provider", [
  "OPENAI",
  "ANTHROPIC",
  "GOOGLE",
  "XAI",
  "DEEPSEEK",
]);

export const strategies = pgTable("strategies", {
  active: boolean("active").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  entryThreshold: integer("entry_threshold").notNull(),
  exitThreshold: integer("exit_threshold").notNull(),
  id: uuid("id").primaryKey().defaultRandom(),
  llmProvider: llmProviderEnum("llm_provider").notNull(),
  maxPositionPct: numeric("max_position_pct").notNull(),
  name: text("name").notNull(),
  stopLossPct: numeric("stop_loss_pct").notNull(),
  type: strategyTypeEnum("type").notNull(),
});

// normalized rather than array columns — makes "which active strategies
// watch BTC" a plain join instead of an array-contains query
export const strategyAssets = pgTable(
  "strategy_assets",
  {
    asset: text("asset").notNull(),
    strategyId: uuid("strategy_id")
      .notNull()
      .references(() => strategies.id),
  },
  (t) => ({ pk: primaryKey({ columns: [t.strategyId, t.asset] }) }),
);

export const strategySignalSources = pgTable(
  "strategy_signal_sources",
  {
    source: signalSourceEnum("source").notNull(),
    strategyId: uuid("strategy_id")
      .notNull()
      .references(() => strategies.id),
  },
  (t) => ({ pk: primaryKey({ columns: [t.strategyId, t.source] }) }),
);
