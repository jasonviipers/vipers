ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "intent_hash" text DEFAULT '' NOT NULL;--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."ledger_entry_side" AS ENUM('debit', 'credit');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ledger_accounts" (
  "account_code" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "currency" text NOT NULL,
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  CONSTRAINT "ledger_accounts_code_currency_uidx" UNIQUE("account_code", "currency")
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ledger_transactions" (
  "account_id" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "idempotency_key" text NOT NULL,
  "metadata" jsonb,
  "source" text NOT NULL,
  CONSTRAINT "ledger_transactions_idempotency_key_unique" UNIQUE("idempotency_key")
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ledger_transactions_account_time_idx" ON "ledger_transactions" USING btree ("account_id", "created_at");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ledger_entries" (
  "account_id" uuid NOT NULL,
  "amount" numeric NOT NULL,
  "currency" text NOT NULL,
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "side" "ledger_entry_side" NOT NULL,
  "transaction_id" uuid NOT NULL
);--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_account_id_ledger_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."ledger_accounts"("id");
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_transaction_id_ledger_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."ledger_transactions"("id");
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ledger_entries_transaction_idx" ON "ledger_entries" USING btree ("transaction_id");