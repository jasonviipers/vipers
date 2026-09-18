import {
  bigint,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Durable cache of ingested point-in-time (PIT) datasets for backtests and
 * walk-forward runs (checklist §7 — see src/lib/jobs/pit-ingestion-job.ts
 * and src/ai/capital-engine/point-in-time.ts).
 *
 * One row per (asset, broker, exact window). The `dataset` jsonb holds the
 * full PIT dataset (points sorted by asOf); `datasetHash` is the canonical
 * sha256 that a backtest pins into its promotion record — a later run can
 * prove it consumed the SAME bytes. Rows are never edited: a longer window
 * is a new row (new hash), so older runs stay reproducible against their
 * pinned hash.
 */
export const pitDatasets = pgTable(
  "pit_datasets",
  {
    asset: text("asset").notNull(),
    brokerId: text("broker_id").notNull(),
    dataset: jsonb("dataset").notNull(),
    datasetHash: text("dataset_hash").notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    id: uuid("id").primaryKey().defaultRandom(),
    /** Inclusive coverage window, epoch ms. */
    windowEndMs: bigint("window_end_ms", { mode: "number" }).notNull(),
    windowStartMs: bigint("window_start_ms", { mode: "number" }).notNull(),
  },
  (t) => ({
    // Same (asset, broker, window) → same dataset; ingestion is idempotent.
    windowUnique: uniqueIndex("pit_datasets_window_uidx").on(
      t.asset,
      t.brokerId,
      t.windowStartMs,
      t.windowEndMs,
    ),
    windowIdx: index("pit_datasets_window_idx").on(
      t.asset,
      t.brokerId,
      t.windowStartMs,
    ),
  }),
);
