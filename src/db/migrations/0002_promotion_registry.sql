CREATE TYPE "public"."strategy_plugin_stage" AS ENUM('DRAFT', 'BACKTEST', 'WALK_FORWARD', 'SHADOW', 'PAPER', 'CANARY', 'LIVE', 'HALTED');--> statement-breakpoint
CREATE TABLE "strategy_plugins" (
	"capabilities" jsonb NOT NULL,
	"config_hash" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"evidence_requirements" jsonb NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"plugin_id" text PRIMARY KEY NOT NULL,
	"plugin_version" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "strategy_promotions" (
	"config_hash" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"data_snapshot_ids" jsonb NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"metrics" jsonb,
	"plugin_id" text NOT NULL,
	"plugin_version" text NOT NULL,
	"policy_hash" text NOT NULL,
	"stage" "strategy_plugin_stage" NOT NULL
);
--> statement-breakpoint
ALTER TABLE "strategy_promotions" ADD CONSTRAINT "strategy_promotions_plugin_id_strategy_plugins_plugin_id_fk" FOREIGN KEY ("plugin_id") REFERENCES "public"."strategy_plugins"("plugin_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "strategy_promotions_plugin_stage_idx" ON "strategy_promotions" USING btree ("plugin_id","stage","created_at");