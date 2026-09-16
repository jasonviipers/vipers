import {
  index,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { positions } from "./trading";

export const ledgerEntrySideEnum = pgEnum("ledger_entry_side", [
  "debit",
  "credit",
]);

/** Independent double-entry ledger accounts. Account balances are derived. */
export const ledgerAccounts = pgTable(
  "ledger_accounts",
  {
    accountCode: text("account_code").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    currency: text("currency").notNull(),
    id: uuid("id").primaryKey().defaultRandom(),
  },
  (t) => ({
    accountCurrencyUnique: uniqueIndex("ledger_accounts_code_currency_uidx").on(
      t.accountCode,
      t.currency,
    ),
  }),
);

/** Immutable transaction headers; idempotencyKey prevents duplicate posts. */
export const ledgerTransactions = pgTable(
  "ledger_transactions",
  {
    accountId: text("account_id").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    id: uuid("id").primaryKey().defaultRandom(),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    metadata: jsonb("metadata"),
    source: text("source").notNull(),
  },
  (t) => ({
    accountTimeIdx: index("ledger_transactions_account_time_idx").on(
      t.accountId,
      t.createdAt,
    ),
  }),
);

/** Debit/credit legs. Every transaction must balance per currency. */
export const ledgerEntries = pgTable(
  "ledger_entries",
  {
    accountId: uuid("account_id")
      .notNull()
      .references(() => ledgerAccounts.id),
    amount: numeric("amount").notNull(),
    currency: text("currency").notNull(),
    id: uuid("id").primaryKey().defaultRandom(),
    side: ledgerEntrySideEnum("side").notNull(),
    transactionId: uuid("transaction_id")
      .notNull()
      .references(() => ledgerTransactions.id),
  },
  (t) => ({
    transactionIdx: index("ledger_entries_transaction_idx").on(t.transactionId),
  }),
);

export const ledgerReconciliationStatusEnum = pgEnum(
  "ledger_reconciliation_status",
  ["MATCHED", "DRIFT", "UNKNOWN"],
);

/** Append-only order lifecycle observations from venues. */
export const ledgerOrderEvents = pgTable(
  "ledger_order_events",
  {
    brokerOrderId: text("broker_order_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    eventType: text("event_type").notNull(),
    id: uuid("id").primaryKey().defaultRandom(),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    payload: jsonb("payload").notNull(),
    proposalId: text("proposal_id").notNull(),
  },
  (t) => ({
    proposalTimeIdx: index("ledger_order_events_proposal_time_idx").on(
      t.proposalId,
      t.createdAt,
    ),
  }),
);

/** Position-lot facts used for future realized/unrealized P&L accounting. */
export const ledgerPositionLots = pgTable(
  "ledger_position_lots",
  {
    asset: text("asset").notNull(),
    costBasis: numeric("cost_basis").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    id: uuid("id").primaryKey().defaultRandom(),
    positionId: text("position_id").notNull(),
    quantity: numeric("quantity").notNull(),
    status: text("status").notNull(),
  },
  (t) => ({
    positionIdx: index("ledger_position_lots_position_idx").on(t.positionId),
  }),
);

/** Timestamped valuation marks; marks are observations, never balance edits. */
export const ledgerMarks = pgTable(
  "ledger_marks",
  {
    asset: text("asset").notNull(),
    contentHash: text("content_hash").notNull().unique(),
    observedAt: timestamp("observed_at").notNull(),
    price: numeric("price").notNull(),
    source: text("source").notNull(),
  },
  (t) => ({
    assetTimeIdx: index("ledger_marks_asset_time_idx").on(
      t.asset,
      t.observedAt,
    ),
  }),
);

/** Venue-to-ledger reconciliation observations. */
export const ledgerReconciliations = pgTable(
  "ledger_reconciliations",
  {
    accountId: text("account_id").notNull(),
    actual: jsonb("actual").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    difference: jsonb("difference").notNull(),
    expected: jsonb("expected").notNull(),
    id: uuid("id").primaryKey().defaultRandom(),
    source: text("source").notNull(),
    status: ledgerReconciliationStatusEnum("status").notNull(),
  },
  (t) => ({
    accountTimeIdx: index("ledger_reconciliations_account_time_idx").on(
      t.accountId,
      t.createdAt,
    ),
  }),
);

/** Hash chain for ledger/audit payload integrity. */
export const ledgerAuditChain = pgTable(
  "ledger_audit_chain",
  {
    currentHash: text("current_hash").notNull().unique(),
    entityId: text("entity_id").notNull(),
    entityType: text("entity_type").notNull(),
    id: uuid("id").primaryKey().defaultRandom(),
    payload: jsonb("payload").notNull(),
    previousHash: text("previous_hash"),
    recordedAt: timestamp("recorded_at").notNull().defaultNow(),
  },
  (t) => ({
    entityTimeIdx: index("ledger_audit_chain_entity_time_idx").on(
      t.entityType,
      t.entityId,
      t.recordedAt,
    ),
  }),
);

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
