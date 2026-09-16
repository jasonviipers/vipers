ALTER TABLE "decision_ledger" ADD COLUMN "metadata" jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "decision_snapshots" ADD COLUMN "metadata" jsonb NOT NULL;