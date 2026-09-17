-- Per-plugin monotonic lineage sequence. All writes go through
-- appendPromotionRecord (seq = head.seq + 1); UNIQUE (plugin_id, seq) makes
-- a concurrent double-append from another replica impossible to commit.
-- Repeated stages are legal (each lifecycle cycle appends HALTED/DRAFT), so
-- the constraint is on lineage ORDER, not on stage values.
ALTER TABLE "strategy_promotions" ADD COLUMN "seq" integer;--> statement-breakpoint
-- Backfill: order existing lineage by createdAt (the pre-seq ordering the
-- reader used), per plugin.
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY plugin_id ORDER BY created_at ASC, id ASC
         ) AS rn
  FROM strategy_promotions
)
UPDATE strategy_promotions SET seq = ranked.rn
FROM ranked WHERE strategy_promotions.id = ranked.id;--> statement-breakpoint
-- Enforce NOT NULL only after every row has a sequence number.
ALTER TABLE "strategy_promotions" ALTER COLUMN "seq" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "strategy_promotions_plugin_seq_uidx" ON "strategy_promotions" USING btree ("plugin_id","seq");
