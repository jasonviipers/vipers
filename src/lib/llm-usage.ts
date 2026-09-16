import { gte, sql } from "drizzle-orm";

import { db } from "@/db";
import { llmUsage } from "@/db/schema/llm-usage";
import { log } from "@/lib/evlog";
import type { LlmProviderId } from "@/lib/llm-credentials";
import { getLlmPricing, inferLlmProvider } from "@/lib/llm-pricing";

interface UsageInput {
  agentId?: string;
  correlationId?: string;
  inputTokens: number;
  model: string;
  outputTokens: number;
  provider?: string;
  totalTokens: number;
}

/**
 * Persist a completed LLM call's usage. Fire-and-forget: called
 * after generateText() returns; a DB hiccup must not break the pipeline.
 */
export function recordLlmUsage(usage: UsageInput): void {
  const { inputTokens, outputTokens, model } = usage;
  if (!inputTokens && !outputTokens) {
    return;
  }

  // The model id is the ground truth for billing. When it's one of the
  // known fleet models, its owning provider wins over the provider that
  // was "asked for" (covers the GOOGLE fallback when a provider lacks a key).
  const provider: LlmProviderId = inferLlmProvider(model);
  const rates = getLlmPricing(provider, model);
  const cost = inputTokens * rates.input + outputTokens * rates.output;

  setImmediate(async () => {
    try {
      await db.insert(llmUsage).values({
        agentId: usage.agentId ?? null,
        correlationId: usage.correlationId ?? null,
        cost: String(cost),
        inputTokens: String(inputTokens),
        model,
        outputTokens: String(outputTokens),
        provider,
        totalTokens: String(usage.totalTokens),
      });
    } catch (error) {
      log.warn({
        message: "llm_usage insert failed",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
}

export interface LlmUsageSummaryData {
  todayCost: number;
  todayInputTokens: number;
  todayOutputTokens: number;
  totalCost: number;
  totalInputTokens: number;
  totalOutputTokens: number;
}

function startOfLocalDay(daysAgo = 0): Date {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  now.setDate(now.getDate() - daysAgo);
  return now;
}

/**
 * Aggregate LLM spend for the status endpoint. Returns zeros when the
 * table is empty or the DB is unreachable — never throws.
 */
export async function llmUsageSummary(): Promise<LlmUsageSummaryData> {
  const empty: LlmUsageSummaryData = {
    todayCost: 0,
    todayInputTokens: 0,
    todayOutputTokens: 0,
    totalCost: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
  };

  try {
    const [totals] = await db
      .select({
        cost: sql<string>`coalesce(sum(${llmUsage.cost}), '0')`,
        inputTokens: sql<string>`coalesce(sum(${llmUsage.inputTokens}), '0')`,
        outputTokens: sql<string>`coalesce(sum(${llmUsage.outputTokens}), '0')`,
      })
      .from(llmUsage);

    const today = startOfLocalDay(0);
    const [todayRow] = await db
      .select({
        cost: sql<string>`coalesce(sum(${llmUsage.cost}), '0')`,
        inputTokens: sql<string>`coalesce(sum(${llmUsage.inputTokens}), '0')`,
        outputTokens: sql<string>`coalesce(sum(${llmUsage.outputTokens}), '0')`,
      })
      .from(llmUsage)
      .where(gte(llmUsage.createdAt, today));

    return {
      todayCost: Number(todayRow?.cost ?? 0),
      todayInputTokens: Number(todayRow?.inputTokens ?? 0),
      todayOutputTokens: Number(todayRow?.outputTokens ?? 0),
      totalCost: Number(totals?.cost ?? 0),
      totalInputTokens: Number(totals?.inputTokens ?? 0),
      totalOutputTokens: Number(totals?.outputTokens ?? 0),
    };
  } catch {
    return empty;
  }
}
