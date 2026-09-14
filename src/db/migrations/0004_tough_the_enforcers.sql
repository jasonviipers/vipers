CREATE TABLE "runtime_settings" (
	"consensus_quorum" integer,
	"debug_mode" boolean DEFAULT false NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"max_daily_loss_pct" integer,
	"max_open_positions" integer,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
