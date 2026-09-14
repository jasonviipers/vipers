import {
  index,
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
  "FILLED",
  "FAILED",
  "BLOCKED",
]);

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
    mode: text("mode").notNull(), // "live" (OKX) or "paper" (notional book)
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
