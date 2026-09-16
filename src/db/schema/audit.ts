import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Immutable decision snapshot — the audit record for one consensus decision.
 *
 * One row per risk-approved-or-rejected proposal, written ONCE after the
 * decision is final (including the order outcome when one happened, or the
 * block reason). `contentHash` is a sha256 over the canonicalised inputs +
 * outcome, so any later edit to the row (or the events it claims to reflect)
 * is detectable by re-hashing and comparing. This is the durable replay
 * surface the event bus does not provide.
 */
/** Append-only decision events independent of the in-process event bus. */
export const decisionLedger = pgTable(
  "decision_ledger",
  {
    contentHash: text("content_hash").notNull().unique(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    eventType: text("event_type").notNull(),
    id: uuid("id").primaryKey().defaultRandom(),
    intentHash: text("intent_hash").notNull(),
    metadata: jsonb("metadata").notNull(),
    payload: jsonb("payload").notNull(),
    proposalId: text("proposal_id").notNull(),
  },
  (t) => ({
    proposalTimeIdx: index("decision_ledger_proposal_time_idx").on(
      t.proposalId,
      t.createdAt,
    ),
  }),
);

export const decisionSnapshots = pgTable(
  "decision_snapshots",
  {
    asset: text("asset").notNull(),
    contentHash: text("content_hash").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    id: uuid("id").primaryKey().defaultRandom(),
    /** All inputs the decision was made on (signal, technicals, proposal, consensus). */
    inputSnapshot: jsonb("input_snapshot").notNull(),
    /** Hash of the exact proposal and evidence before risk/order outcome. */
    intentHash: text("intent_hash").notNull().default(""),
    /** Stable correlation, policy, plugin, model, and data timestamp metadata. */
    metadata: jsonb("metadata").notNull(),
    /** Risk decision + order outcome (or block reason). */
    outcome: jsonb("outcome").notNull(),
    /** The consensus workflow's risk-approved/rejected proposal id. */
    proposalId: text("proposal_id").notNull().unique(),
    signalId: text("signal_id").notNull(),
  },
  (t) => ({
    assetTimeIdx: index("decision_snapshots_asset_time_idx").on(
      t.asset,
      t.createdAt,
    ),
  }),
);
