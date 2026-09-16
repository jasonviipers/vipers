import {
  index,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Per-call LLM usage tracking — one row per generateText() invocation.
 *
 * Used by the status-bar to show cumulative LLM spend and by the
 * /api/status endpoint for aggregation. The cost column is computed
 * at write-time from the pricing table so historical rows stay accurate
 * even if rates change.
 */
export const llmUsage = pgTable(
  "llm_usage",
  {
    agentId: text("agent_id"),
    correlationId: text("correlation_id"),
    cost: numeric("cost").notNull().default("0"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    id: uuid("id").primaryKey().defaultRandom(),
    inputTokens: numeric("input_tokens").notNull().default("0"),
    model: text("model").notNull(),
    outputTokens: numeric("output_tokens").notNull().default("0"),
    provider: text("provider").notNull(),
    totalTokens: numeric("total_tokens").notNull().default("0"),
  },
  (t) => ({
    createdIdx: index("llm_usage_created_idx").on(t.createdAt),
  }),
);
