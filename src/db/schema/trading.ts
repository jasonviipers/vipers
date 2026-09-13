import {
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
  strategyId: uuid("strategy_id")
    .notNull()
    .references(() => strategies.id),
});

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
