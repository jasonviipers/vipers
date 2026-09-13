import {
  index,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { positions } from "./trading";

export const capitalTransactionTypeEnum = pgEnum("capital_txn_type", [
  "deposit",
  "withdrawal",
  "realized_pnl",
  "fee",
]);

// ledger = source of truth for capital; balances are derived, never stored raw
export const capitalTransactions = pgTable("capital_transactions", {
  accountId: text("account_id").notNull(),
  amount: numeric("amount").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  id: uuid("id").primaryKey().defaultRandom(),
  relatedPositionId: uuid("related_position_id").references(() => positions.id),
  type: capitalTransactionTypeEnum("type").notNull(),
});

// periodic rollups for the daily/weekly/monthly PnL cards + historical charting
export const portfolioSnapshots = pgTable(
  "portfolio_snapshots",
  {
    accountId: text("account_id").notNull(),
    availableCapital: numeric("available_capital").notNull(),
    id: uuid("id").primaryKey().defaultRandom(),
    investedCapital: numeric("invested_capital").notNull(),
    takenAt: timestamp("taken_at").notNull().defaultNow(),
    totalCapital: numeric("total_capital").notNull(),
  },
  (t) => ({
    acctTimeIdx: index("portfolio_acct_time_idx").on(t.accountId, t.takenAt),
  }),
);

export const eventTypeEnum = pgEnum("event_type", [
  "trade",
  "signal",
  "alert",
  "heartbeat",
]);

export const events = pgTable(
  "events",
  {
    asset: text("asset"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    id: uuid("id").primaryKey().defaultRandom(),
    message: text("message").notNull(),
    source: text("source").notNull(),
    type: eventTypeEnum("type").notNull(),
    value: numeric("value"),
  },
  (t) => ({ timeIdx: index("events_time_idx").on(t.createdAt) }),
);
