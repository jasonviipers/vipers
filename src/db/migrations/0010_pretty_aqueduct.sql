ALTER TABLE "orders" ADD COLUMN "broker_id" text DEFAULT 'okx' NOT NULL;--> statement-breakpoint
ALTER TABLE "runtime_settings" ADD COLUMN "active_broker_id" text DEFAULT 'okx' NOT NULL;