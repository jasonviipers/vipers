CREATE TABLE "agent_llm_configs" (
	"agent_id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
