CREATE TABLE "risk_controls" (
	"id" text PRIMARY KEY NOT NULL,
	"kill_switch_enabled" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
