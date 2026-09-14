CREATE TABLE "broker_credentials" (
	"api_key_cipher" text NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"mode" text DEFAULT 'demo' NOT NULL,
	"passphrase_cipher" text NOT NULL,
	"region" text DEFAULT 'default' NOT NULL,
	"secret_cipher" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "llm_credentials" (
	"api_key_cipher" text NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"label" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "runtime_settings" ADD COLUMN "default_llm_provider" text;