import {
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const teamEnum = pgEnum("team", [
  "SENTIMENT",
  "ANALYSIS",
  "EXECUTION",
  "RISK",
  "COORDINATION",
]);
export const agentStatusEnum = pgEnum("agent_status", [
  "online",
  "offline",
  "error",
  "busy",
]);

export const agents = pgTable("agents", {
  createdAt: timestamp("created_at").notNull().defaultNow(),
  id: text("id").primaryKey(),
  lastHeartbeatAt: timestamp("last_heartbeat_at"),
  name: text("name").notNull(),
  role: text("role").notNull(),
  status: agentStatusEnum("status").notNull().default("offline"),
  team: teamEnum("team").notNull(),
});

// pnl/roi/winRate/trades/sharpe/maxDrawdown are DERIVED from positions,
// not raw facts — cache them here and recompute on trade close / on a cron,
// rather than trying to keep them live on every read.
export const agentStats = pgTable("agent_stats", {
  agentId: text("agent_id")
    .primaryKey()
    .references(() => agents.id),
  maxDrawdown: numeric("max_drawdown").notNull().default("0"),
  pnl: numeric("pnl").notNull().default("0"),
  roi: numeric("roi").notNull().default("0"),
  sharpe: numeric("sharpe").notNull().default("0"),
  trades: integer("trades").notNull().default(0),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  winRate: numeric("win_rate").notNull().default("0"),
});

// equityData (the sparkline array) is a time series, not a JSON blob —
// store one row per snapshot so you can query/aggregate it properly.
export const equitySnapshots = pgTable(
  "equity_snapshots",
  {
    agentId: text("agent_id")
      .notNull()
      .references(() => agents.id),
    id: uuid("id").primaryKey().defaultRandom(),
    recordedAt: timestamp("recorded_at").notNull().defaultNow(),
    value: numeric("value").notNull(),
  },
  (t) => ({
    agentTimeIdx: index("equity_agent_time_idx").on(t.agentId, t.recordedAt),
  }),
);
