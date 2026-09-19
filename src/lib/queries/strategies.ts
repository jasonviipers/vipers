import { queryOptions } from "@tanstack/react-query";
import { z } from "zod";

export const STRATEGY_TYPES = [
  "MOMENTUM",
  "SENTIMENT_ONLY",
  "MEAN_REVERSION",
] as const;
export const LLM_PROVIDERS = [
  "OPENAI",
  "ANTHROPIC",
  "GOOGLE",
  "XAI",
  "DEEPSEEK",
  "OLLAMA",
] as const;
export const SIGNAL_SOURCES = ["reddit", "twitter", "rss"] as const;

export type StrategyType = (typeof STRATEGY_TYPES)[number];
export type LlmProvider = (typeof LLM_PROVIDERS)[number];
export type SignalSource = (typeof SIGNAL_SOURCES)[number];

/** Client+server shared shape of a strategy (mirrors the DB schema). */
export interface StrategyDto {
  id: string;
  name: string;
  type: StrategyType;
  assets: string[];
  signalSources: SignalSource[];
  llmProvider: LlmProvider;
  entryThreshold: number;
  exitThreshold: number;
  maxPositionPct: number;
  stopLossPct: number;
  active: boolean;
  createdAt: string;
}

export interface StrategiesResponse {
  items: StrategyDto[];
}

/**
 * Single validation source for create/update payloads — imported by both
 * /api/strategies routes and the mutation module.
 */
export const strategyInputSchema = z.object({
  name: z.string().min(2).max(64),
  type: z.enum(STRATEGY_TYPES),
  assets: z.array(z.string().min(1).max(12)).min(1),
  signalSources: z.array(z.enum(SIGNAL_SOURCES)).min(1),
  llmProvider: z.enum(LLM_PROVIDERS),
  entryThreshold: z.number().int().min(0).max(100),
  exitThreshold: z.number().int().min(0).max(100),
  maxPositionPct: z.number().min(0).max(100),
  stopLossPct: z.number().min(0).max(100),
  active: z.boolean(),
});

export type StrategyInput = z.infer<typeof strategyInputSchema>;

export const strategyKeys = {
  all: ["strategies"] as const,
  lists: () => [...strategyKeys.all, "list"] as const,
};

async function fetchJson<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`API ${response.status}: ${detail || response.statusText}`);
  }
  return (await response.json()) as T;
}

export const strategyQueries = {
  list: (enabled = true) =>
    queryOptions({
      enabled,
      queryKey: strategyKeys.lists(),
      queryFn: () => fetchJson<StrategiesResponse>("/api/strategies"),
      // Strategies change rarely; poll keeps multi-tab sessions honest.
      refetchInterval: 60_000,
      staleTime: 30_000,
    }),
};
