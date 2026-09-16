CREATE TABLE "llm_usage" (
	"agent_id" text,
	"correlation_id" text,
	"cost" numeric DEFAULT '0' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"input_tokens" numeric DEFAULT '0' NOT NULL,
	"model" text NOT NULL,
	"output_tokens" numeric DEFAULT '0' NOT NULL,
	"provider" text NOT NULL,
	"total_tokens" numeric DEFAULT '0' NOT NULL
);
--> statement-breakpoint
CREATE INDEX "llm_usage_created_idx" ON "llm_usage" USING btree ("created_at");