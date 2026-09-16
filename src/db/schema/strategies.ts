import {
  boolean,
  index,
  integer,
  jsonb,
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

export const strategyPluginStageEnum = pgEnum("strategy_plugin_stage", [
  "DRAFT",
  "BACKTEST",
  "WALK_FORWARD",
  "SHADOW",
  "PAPER",
  "CANARY",
  "LIVE",
  "HALTED",
]);

/** Versioned strategy/plugin identity and evidence contract. */
export const strategyPlugins = pgTable("strategy_plugins", {
  capabilities: jsonb("capabilities").notNull(),
  configHash: text("config_hash").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  evidenceRequirements: jsonb("evidence_requirements").notNull(),
  enabled: boolean("enabled").notNull().default(false),
  pluginId: text("plugin_id").primaryKey(),
  pluginVersion: text("plugin_version").notNull(),
});

/** Durable promotion lineage; every stage change is an append-only record. */
export const strategyPromotions = pgTable(
  "strategy_promotions",
  {
    configHash: text("config_hash").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    dataSnapshotIds: jsonb("data_snapshot_ids").notNull(),
    id: uuid("id").primaryKey().defaultRandom(),
    metrics: jsonb("metrics"),
    pluginId: text("plugin_id")
      .notNull()
      .references(() => strategyPlugins.pluginId),
    pluginVersion: text("plugin_version").notNull(),
    policyHash: text("policy_hash").notNull(),
    stage: strategyPluginStageEnum("stage").notNull(),
  },
  (t) => ({
    pluginStageIdx: index("strategy_promotions_plugin_stage_idx").on(
      t.pluginId,
      t.stage,
      t.createdAt,
    ),
  }),
);

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
