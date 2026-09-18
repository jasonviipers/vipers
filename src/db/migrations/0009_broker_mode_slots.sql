-- Broker per-mode credential slots: demo and live credentials stored
-- side by side (encrypted) with an explicit active_mode pointer, so
-- switching to live no longer overwrites (kills) the demo setup.
-- The previous single-set columns described the operator's demo/paper
-- setup first, so they are RENAMED to the demo slot (ciphertext carried
-- forward, never dropped) and live-slot twins are added nullable.
ALTER TABLE "broker_credentials" RENAME COLUMN "api_key_cipher" TO "api_key_demo_cipher";--> statement-breakpoint
ALTER TABLE "broker_credentials" RENAME COLUMN "passphrase_cipher" TO "passphrase_demo_cipher";--> statement-breakpoint
ALTER TABLE "broker_credentials" RENAME COLUMN "secret_cipher" TO "secret_demo_cipher";--> statement-breakpoint
ALTER TABLE "broker_credentials" RENAME COLUMN "mode" TO "active_mode";--> statement-breakpoint
ALTER TABLE "broker_credentials" ADD COLUMN "api_key_live_cipher" text;--> statement-breakpoint
ALTER TABLE "broker_credentials" ADD COLUMN "passphrase_live_cipher" text;--> statement-breakpoint
ALTER TABLE "broker_credentials" ADD COLUMN "secret_live_cipher" text;--> statement-breakpoint
UPDATE "broker_credentials" SET "active_mode" = 'demo' WHERE "active_mode" IS NULL;--> statement-breakpoint
ALTER TABLE "broker_credentials" ALTER COLUMN "active_mode" SET DEFAULT 'demo';--> statement-breakpoint
