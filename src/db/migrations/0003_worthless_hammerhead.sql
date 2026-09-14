CREATE TYPE "public"."order_status" AS ENUM('FILLED', 'FAILED', 'BLOCKED');--> statement-breakpoint
CREATE TABLE "orders" (
	"agent_id" text NOT NULL,
	"asset" text NOT NULL,
	"broker_order_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"detail" text,
	"direction" "direction" NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mode" text NOT NULL,
	"position_size_pct" numeric NOT NULL,
	"proposal_id" text NOT NULL,
	"quantity" numeric DEFAULT '0' NOT NULL,
	"status" "order_status" NOT NULL,
	CONSTRAINT "orders_proposal_id_unique" UNIQUE("proposal_id")
);
--> statement-breakpoint
ALTER TABLE "positions" ALTER COLUMN "strategy_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "orders_created_idx" ON "orders" USING btree ("created_at");