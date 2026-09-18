import {
  boolean,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { agents } from "./agent";
import { signals } from "./signals";
import { strategies } from "./strategies";

export const directionEnum = pgEnum("direction", ["LONG", "SHORT"]);
export const positionStatusEnum = pgEnum("position_status", ["OPEN", "CLOSED"]);
export const orderStatusEnum = pgEnum("order_status", [
  "PENDING",
  "FILLED",
  "FAILED",
  "BLOCKED",
]);

/**
 * Server-owned operator settings that the trading pipeline and API routes
 * actually enforce (singleton row, id = "global"). Written through
 * PUT /api/settings/runtime; the localStorage-backed terminal settings stay
 * display-only. Enforced today:
 *  - consensusQuorum: COORDINATION vote threshold in the workflow
 *  - maxDailyLossPct: RISK daily-loss cap (overrides the agent-config default)
 *  - maxOpenPositions: RISK concurrency cap on open positions
 *  - debugMode: the events feed surfaces raw pipeline detail when true
 *  - heartbeatInterval: agent online-window (interval × 3) in fleet/feed routes
 */
export const runtimeSettings = pgTable("runtime_settings", {
  /**
   * Master switch for the autonomous agent pipeline (signal → analysis →
   * consensus → risk → execution). Default OFF: the swarm only runs when
   * the operator explicitly enables automation in /settings. Manual runs
   * (POST /api/agents/db/[id]/run) are unaffected.
   */
  /**
   * Which broker orders route through ("okx" | "alpaca"). Durable and
   * server-owned (runtime_settings singleton row), written via PUT
   * /api/settings/runtime; the execution tool resolves this per order so
   * switching brokers is a deliberate operator action, never a
   * localStorage preference the pipeline can ignore.
   */
  activeBrokerId: text("active_broker_id").notNull().default("okx"),
  automationEnabled: boolean("automation_enabled").notNull().default(false),
  /** Seconds between automatic full-pipeline passes (bounded 60–3600). */
  automationIntervalSec: integer("automation_interval_sec"),
  /** Default LLM provider for new strategies ("OPENAI"|"ANTHROPIC"|"GOOGLE"|"XAI"|"DEEPSEEK"). */
  defaultLlmProvider: text("default_llm_provider"),
  consensusQuorum: integer("consensus_quorum"),
  debugMode: boolean("debug_mode").notNull().default(false),
  /** Seconds; drives the agent online-window (interval × 3, bounded). */
  heartbeatInterval: integer("heartbeat_interval"),
  id: text("id").primaryKey(),
  maxDailyLossPct: integer("max_daily_loss_pct"),
  maxOpenPositions: integer("max_open_positions"),
  /**
   * Canary-stage controls (checklist §7 — maximum canary allocation and
   * loss budget). Percent, integer. NULL = not armed; canary controls, like
   * rollback triggers, must be deliberately predeclared and are never
   * inherited from a default.
   *
   * canaryMaxAllocationPct — the per-order position-size ceiling the risk
   * gate enforces for a plugin whose lineage head is at CANARY. When NULL,
   * new risk for canary plugins is REFUSED (fail closed) rather than
   * allowed at the live sizing.
   *
   * canaryLossBudgetPct — the loss budget the rollback monitor enforces
   * for CANARY lineage heads: the effective loss threshold is the tighter
   * of this and rollbackMaxLossPct (ignored for LIVE). See
   * src/lib/rollback-policy.ts.
   */
  canaryLossBudgetPct: integer("canary_loss_budget_pct"),
  canaryMaxAllocationPct: integer("canary_max_allocation_pct"),
  /**
   * Auto-rollback thresholds for capital-bearing strategy plugins (see
   * src/lib/jobs/strategy-rollback-job.ts). Percent, integer; a plugin at
   * CANARY/LIVE whose lineage-head metrics breach a configured threshold
   * (>= comparison) is disabled through the audited kill switch. NULL =
   * disabled — a rollback trigger must be deliberately predeclared.
   */
  rollbackMaxDrawdownPct: integer("rollback_max_drawdown_pct"),
  rollbackMaxLossPct: integer("rollback_max_loss_pct"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/**
 * Broker credentials entered in the /settings UI and stored SERVER-SIDE,
 * encrypted at rest (AES-256-GCM via secret-box). Replaces the old
 * OKX_* environment variables. Singleton rows keyed by broker id
 * ("okx" today); deleting the row disconnects the broker.
 *
 * `mode` picks the OKX paper endpoints (demo) vs real capital;
 * `region` picks the REST/WS domains. Plaintext never leaves the server
 * — only masked hints and booleans are ever returned to the client.
 */
export const brokerCredentials = pgTable("broker_credentials", {
  activeMode: text("active_mode").notNull().default("demo"), // "demo" | "live" — which slot orders route through
  /** Demo slot: always populated (backfilled from the legacy single set). */
  apiKeyDemoCipher: text("api_key_demo_cipher").notNull(),
  /** Live slot: nullable until the operator saves live credentials. */
  apiKeyLiveCipher: text("api_key_live_cipher"),
  id: text("id").primaryKey(), // broker id, e.g. "okx"
  passphraseDemoCipher: text("passphrase_demo_cipher").notNull(),
  passphraseLiveCipher: text("passphrase_live_cipher"),
  region: text("region").notNull().default("default"), // "default" | "eea" | "us" — account-level, shared by both slots
  secretDemoCipher: text("secret_demo_cipher").notNull(),
  secretLiveCipher: text("secret_live_cipher"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/**
 * LLM provider API keys managed through the /settings UI, encrypted at
 * rest (secret-box). One row per provider id ("OPENAI", "ANTHROPIC",
 * "GOOGLE", "XAI", "DEEPSEEK"). Keys entered here override the
 * corresponding environment variables at model-resolution time.
 */
export const llmCredentials = pgTable("llm_credentials", {
  apiKeyCipher: text("api_key_cipher").notNull(),
  id: text("id").primaryKey(), // provider id, e.g. "OPENAI"
  label: text("label"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/**
 * Per-agent LLM provider override. NULL (absent row) → the agent inherits
 * the fleet-wide DEFAULT LLM PROVIDER (runtime_settings.defaultLlmProvider);
 * a row pins that one agent to a specific provider so the fleet can run
 * heterogeneous models (e.g. PULSE_READER on GOOGLE, CHART_SCOUT on
 * OPENAI). Written through GET/PUT /api/settings/agent-llm.
 *
 * Keyed by the agent id string from `agentConfigs` — deliberately no FK to
 * `agents`: the fleet table may be empty on a fresh install while these
 * overrides must still apply to the fixed agent identity.
 */
export const agentLlmConfigs = pgTable("agent_llm_configs", {
  agentId: text("agent_id").primaryKey(),
  /** "OPENAI" | "ANTHROPIC" | "GOOGLE" | "XAI" | "DEEPSEEK". */
  provider: text("provider").notNull(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const positions = pgTable("positions", {
  accountId: text("account_id").notNull(), // scopes to the connected QuantEx user — see note below
  agentId: text("agent_id")
    .notNull()
    .references(() => agents.id), // was agentName string
  asset: text("asset").notNull(),
  closedAt: timestamp("closed_at"),
  direction: directionEnum("direction").notNull(),
  entryPrice: numeric("entry_price").notNull(),
  id: uuid("id").primaryKey().defaultRandom(),
  openedAt: timestamp("opened_at").notNull().defaultNow(),
  pnl: numeric("pnl").notNull().default("0"), // cached, refreshed by the price-tick job
  pnlPct: numeric("pnl_pct").notNull().default("0"),
  quantity: numeric("quantity").notNull(),
  signalId: uuid("signal_id").references(() => signals.id), // was signalSource string
  status: positionStatusEnum("status").notNull().default("OPEN"),
  // Nullable: positions opened by the swarm pipeline have no explicit
  // strategy until strategy selection is wired into the workflow.
  strategyId: uuid("strategy_id").references(() => strategies.id),
});

/**
 * Durable order record — the idempotency + audit layer for execution.
 *
 * `proposalId` is UNIQUE: the consensus workflow's risk-approved proposal
 * id doubles as the idempotency key, so a retry of the same proposal (or a
 * duplicate submission after a crash) inserts nothing and returns the
 * original row instead of creating a second order. `brokerOrderId` keeps
 * the exchange's ordId for reconciliation; `detail` carries the adapter's
 * human-readable outcome (fill price, rejection reason, reconcile hint).
 */
export const orders = pgTable(
  "orders",
  {
    agentId: text("agent_id")
      .notNull()
      .references(() => agents.id),
    asset: text("asset").notNull(),
    brokerOrderId: text("broker_order_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    detail: text("detail"),
    direction: directionEnum("direction").notNull(),
    id: uuid("id").primaryKey().defaultRandom(),
    /** Hash of the exact capital intent submitted to execution. */
    intentHash: text("intent_hash").notNull().default(""),
    mode: text("mode").notNull(), // "live" (OKX) or "paper" (notional book)
    /** Broker that routed the order ("okx" | "alpaca"); reconciliation dispatches on it. */
    brokerId: text("broker_id").notNull().default("okx"),
    positionSizePct: numeric("position_size_pct").notNull(),
    proposalId: text("proposal_id").notNull().unique(),
    quantity: numeric("quantity").notNull().default("0"),
    status: orderStatusEnum("status").notNull(),
  },
  (t) => ({
    createdIdx: index("orders_created_idx").on(t.createdAt),
  }),
);

// live price cache. Given how often this updates, seriously consider
// Redis over Postgres for this one table — a price tick every few
// seconds per asset is a write pattern Postgres tolerates but doesn't love.
export const marketPrices = pgTable("market_prices", {
  asset: text("asset").primaryKey(),
  changePct24h: numeric("change_pct_24h").notNull(),
  price: numeric("price").notNull(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  volume24h: text("volume_24h"),
});
