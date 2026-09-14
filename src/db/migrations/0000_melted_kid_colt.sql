CREATE TYPE "public"."agent_status" AS ENUM('online', 'offline', 'error', 'busy');--> statement-breakpoint
CREATE TYPE "public"."team" AS ENUM('SENTIMENT', 'ANALYSIS', 'EXECUTION', 'RISK', 'COORDINATION');--> statement-breakpoint
CREATE TYPE "public"."proposal_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."vote" AS ENUM('for', 'against', 'abstain');--> statement-breakpoint
CREATE TYPE "public"."capital_txn_type" AS ENUM('deposit', 'withdrawal', 'realized_pnl', 'fee');--> statement-breakpoint
CREATE TYPE "public"."event_type" AS ENUM('trade', 'signal', 'alert', 'heartbeat');--> statement-breakpoint
CREATE TYPE "public"."sentiment" AS ENUM('bullish', 'bearish', 'neutral');--> statement-breakpoint
CREATE TYPE "public"."signal_source" AS ENUM('reddit', 'twitter', 'rss');--> statement-breakpoint
CREATE TYPE "public"."llm_provider" AS ENUM('OPENAI', 'ANTHROPIC', 'GOOGLE', 'XAI', 'DEEPSEEK');--> statement-breakpoint
CREATE TYPE "public"."strategy_type" AS ENUM('MOMENTUM', 'SENTIMENT_ONLY', 'MEAN_REVERSION');--> statement-breakpoint
CREATE TYPE "public"."direction" AS ENUM('LONG', 'SHORT');--> statement-breakpoint
CREATE TYPE "public"."position_status" AS ENUM('OPEN', 'CLOSED');--> statement-breakpoint
CREATE TABLE "agent_stats" (
	"agent_id" text PRIMARY KEY NOT NULL,
	"max_drawdown" numeric DEFAULT '0' NOT NULL,
	"pnl" numeric DEFAULT '0' NOT NULL,
	"roi" numeric DEFAULT '0' NOT NULL,
	"score" numeric,
	"score_computed_at" timestamp,
	"sharpe" numeric DEFAULT '0' NOT NULL,
	"trades" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"win_rate" numeric DEFAULT '0' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agents" (
	"created_at" timestamp DEFAULT now() NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"last_heartbeat_at" timestamp,
	"name" text NOT NULL,
	"role" text NOT NULL,
	"status" "agent_status" DEFAULT 'offline' NOT NULL,
	"team" "team" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "equity_snapshots" (
	"agent_id" text NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recorded_at" timestamp DEFAULT now() NOT NULL,
	"value" numeric NOT NULL
);
--> statement-breakpoint
CREATE TABLE "account" (
	"access_token" text,
	"access_token_expires_at" timestamp,
	"account_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"id_token" text,
	"issuer" text NOT NULL,
	"password" text,
	"provider_id" text NOT NULL,
	"refresh_token" text,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"updated_at" timestamp NOT NULL,
	"user_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"ip_address" text,
	"token" text NOT NULL,
	"updated_at" timestamp NOT NULL,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"created_at" timestamp DEFAULT now() NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"image" text,
	"is_anonymous" boolean DEFAULT false NOT NULL,
	"name" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"value" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consensus_proposals" (
	"asset" text NOT NULL,
	"confidence" numeric NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"deadline" timestamp NOT NULL,
	"direction" "direction" NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"proposed_by_agent_id" text NOT NULL,
	"status" "proposal_status" DEFAULT 'pending' NOT NULL,
	"strategy_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consensus_votes" (
	"agent_id" text NOT NULL,
	"confidence" numeric NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"proposal_id" uuid NOT NULL,
	"reasoning" text NOT NULL,
	"vote" "vote" NOT NULL,
	"voted_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "consensus_votes_proposal_id_agent_id_unique" UNIQUE("proposal_id","agent_id")
);
--> statement-breakpoint
CREATE TABLE "capital_transactions" (
	"account_id" text NOT NULL,
	"amount" numeric NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"related_position_id" uuid,
	"type" "capital_txn_type" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"asset" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message" text NOT NULL,
	"source" text NOT NULL,
	"type" "event_type" NOT NULL,
	"value" numeric
);
--> statement-breakpoint
CREATE TABLE "portfolio_snapshots" (
	"account_id" text NOT NULL,
	"available_capital" numeric NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invested_capital" numeric NOT NULL,
	"taken_at" timestamp DEFAULT now() NOT NULL,
	"total_capital" numeric NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signals" (
	"asset" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"raw" jsonb,
	"score" integer NOT NULL,
	"sentiment" "sentiment" NOT NULL,
	"source" "signal_source" NOT NULL,
	"twitter_confirmed" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "strategies" (
	"active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"entry_threshold" integer NOT NULL,
	"exit_threshold" integer NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"llm_provider" "llm_provider" NOT NULL,
	"max_position_pct" numeric NOT NULL,
	"name" text NOT NULL,
	"stop_loss_pct" numeric NOT NULL,
	"type" "strategy_type" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "strategy_assets" (
	"asset" text NOT NULL,
	"strategy_id" uuid NOT NULL,
	CONSTRAINT "strategy_assets_strategy_id_asset_pk" PRIMARY KEY("strategy_id","asset")
);
--> statement-breakpoint
CREATE TABLE "strategy_signal_sources" (
	"source" "signal_source" NOT NULL,
	"strategy_id" uuid NOT NULL,
	CONSTRAINT "strategy_signal_sources_strategy_id_source_pk" PRIMARY KEY("strategy_id","source")
);
--> statement-breakpoint
CREATE TABLE "market_prices" (
	"asset" text PRIMARY KEY NOT NULL,
	"change_pct_24h" numeric NOT NULL,
	"price" numeric NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"volume_24h" text
);
--> statement-breakpoint
CREATE TABLE "positions" (
	"account_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"asset" text NOT NULL,
	"closed_at" timestamp,
	"direction" "direction" NOT NULL,
	"entry_price" numeric NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"opened_at" timestamp DEFAULT now() NOT NULL,
	"pnl" numeric DEFAULT '0' NOT NULL,
	"pnl_pct" numeric DEFAULT '0' NOT NULL,
	"quantity" numeric NOT NULL,
	"signal_id" uuid,
	"status" "position_status" DEFAULT 'OPEN' NOT NULL,
	"strategy_id" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_stats" ADD CONSTRAINT "agent_stats_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equity_snapshots" ADD CONSTRAINT "equity_snapshots_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consensus_proposals" ADD CONSTRAINT "consensus_proposals_proposed_by_agent_id_agents_id_fk" FOREIGN KEY ("proposed_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consensus_proposals" ADD CONSTRAINT "consensus_proposals_strategy_id_strategies_id_fk" FOREIGN KEY ("strategy_id") REFERENCES "public"."strategies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consensus_votes" ADD CONSTRAINT "consensus_votes_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consensus_votes" ADD CONSTRAINT "consensus_votes_proposal_id_consensus_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."consensus_proposals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capital_transactions" ADD CONSTRAINT "capital_transactions_related_position_id_positions_id_fk" FOREIGN KEY ("related_position_id") REFERENCES "public"."positions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategy_assets" ADD CONSTRAINT "strategy_assets_strategy_id_strategies_id_fk" FOREIGN KEY ("strategy_id") REFERENCES "public"."strategies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategy_signal_sources" ADD CONSTRAINT "strategy_signal_sources_strategy_id_strategies_id_fk" FOREIGN KEY ("strategy_id") REFERENCES "public"."strategies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_signal_id_signals_id_fk" FOREIGN KEY ("signal_id") REFERENCES "public"."signals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_strategy_id_strategies_id_fk" FOREIGN KEY ("strategy_id") REFERENCES "public"."strategies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "equity_agent_time_idx" ON "equity_snapshots" USING btree ("agent_id","recorded_at");--> statement-breakpoint
CREATE UNIQUE INDEX "account_issuer_accountId_uidx" ON "account" USING btree ("issuer","account_id");--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "events_time_idx" ON "events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "portfolio_acct_time_idx" ON "portfolio_snapshots" USING btree ("account_id","taken_at");--> statement-breakpoint
CREATE INDEX "signals_asset_time_idx" ON "signals" USING btree ("asset","created_at");