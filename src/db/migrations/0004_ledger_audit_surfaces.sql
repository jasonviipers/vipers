CREATE TYPE "public"."ledger_reconciliation_status" AS ENUM('MATCHED', 'DRIFT', 'UNKNOWN');--> statement-breakpoint
CREATE TABLE "ledger_audit_chain" (
	"current_hash" text NOT NULL,
	"entity_id" text NOT NULL,
	"entity_type" text NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payload" jsonb NOT NULL,
	"previous_hash" text,
	"recorded_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_audit_chain_current_hash_unique" UNIQUE("current_hash")
);
--> statement-breakpoint
CREATE TABLE "ledger_marks" (
	"asset" text NOT NULL,
	"content_hash" text NOT NULL,
	"observed_at" timestamp NOT NULL,
	"price" numeric NOT NULL,
	"source" text NOT NULL,
	CONSTRAINT "ledger_marks_content_hash_unique" UNIQUE("content_hash")
);
--> statement-breakpoint
CREATE TABLE "ledger_order_events" (
	"broker_order_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"event_type" text NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"idempotency_key" text NOT NULL,
	"payload" jsonb NOT NULL,
	"proposal_id" text NOT NULL,
	CONSTRAINT "ledger_order_events_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "ledger_position_lots" (
	"asset" text NOT NULL,
	"cost_basis" numeric NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"position_id" text NOT NULL,
	"quantity" numeric NOT NULL,
	"status" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_reconciliations" (
	"account_id" text NOT NULL,
	"actual" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"difference" jsonb NOT NULL,
	"expected" jsonb NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"status" "ledger_reconciliation_status" NOT NULL
);
--> statement-breakpoint
CREATE INDEX "ledger_audit_chain_entity_time_idx" ON "ledger_audit_chain" USING btree ("entity_type","entity_id","recorded_at");--> statement-breakpoint
CREATE INDEX "ledger_marks_asset_time_idx" ON "ledger_marks" USING btree ("asset","observed_at");--> statement-breakpoint
CREATE INDEX "ledger_order_events_proposal_time_idx" ON "ledger_order_events" USING btree ("proposal_id","created_at");--> statement-breakpoint
CREATE INDEX "ledger_position_lots_position_idx" ON "ledger_position_lots" USING btree ("position_id");--> statement-breakpoint
CREATE INDEX "ledger_reconciliations_account_time_idx" ON "ledger_reconciliations" USING btree ("account_id","created_at");