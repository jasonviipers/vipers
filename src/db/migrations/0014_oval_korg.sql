CREATE TABLE "pit_datasets" (
	"asset" text NOT NULL,
	"broker_id" text NOT NULL,
	"dataset" jsonb NOT NULL,
	"dataset_hash" text NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"window_end_ms" bigint NOT NULL,
	"window_start_ms" bigint NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "pit_datasets_window_uidx" ON "pit_datasets" USING btree ("asset","broker_id","window_start_ms","window_end_ms");--> statement-breakpoint
CREATE INDEX "pit_datasets_window_idx" ON "pit_datasets" USING btree ("asset","broker_id","window_start_ms");