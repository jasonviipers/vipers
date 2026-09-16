CREATE TABLE "decision_ledger" (
	"content_hash" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"event_type" text NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"intent_hash" text NOT NULL,
	"payload" jsonb NOT NULL,
	"proposal_id" text NOT NULL,
	CONSTRAINT "decision_ledger_content_hash_unique" UNIQUE("content_hash")
);
--> statement-breakpoint
CREATE INDEX "decision_ledger_proposal_time_idx" ON "decision_ledger" USING btree ("proposal_id","created_at");