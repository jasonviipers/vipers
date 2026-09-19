import type { LlmProviderId } from "@/lib/llm-credentials";

/**
 * Per-token pricing ($/token) for each provider and model used by the
 * agent fleet. Covers only the fast-tier models actually invoked in
 * production — update when default models change.
 *
 * Source: provider pricing pages as of mid-2025 (input / output
 * averaged). These are approximate; the status-bar is a cost guide,
 * not an invoice.
 */
const PRICING: Record<
  LlmProviderId,
  Record<string, { input: number; output: number }>
> = {
  ANTHROPIC: {
    "claude-haiku-4-5": { input: 0.0000008, output: 0.000004 },
  },
  DEEPSEEK: {
    "deepseek-chat": { input: 0.00000014, output: 0.00000028 },
  },
  GOOGLE: {
    "gemini-flash-latest": { input: 0.000000075, output: 0.0000003 },
  },
  OLLAMA: {
    // Ollama Cloud pricing is plan-based, not per-token; the status-bar cost
    // guide uses the mid-tier estimate so a fleet pinned to Ollama still reads
    // a sensible (approximate) spend.
    "glm-5.3-flash": { input: 0.0000002, output: 0.000001 },
  },
  OPENAI: {
    "gpt-4.1-mini": { input: 0.0000004, output: 0.0000016 },
  },
  XAI: {
    "grok-4-fast": { input: 0.0000003, output: 0.0000015 },
  },
};

const DEFAULT_RATES = { input: 0.0000002, output: 0.000001 };

/** Model-id → provider mapping (each model id belongs to one provider). */
const MODEL_TO_PROVIDER: Record<string, LlmProviderId> = Object.fromEntries(
  Object.entries(PRICING).flatMap(([provider, models]) =>
    Object.keys(models).map((model) => [model, provider]),
  ),
) as Record<string, LlmProviderId>;

/** Look up per-token rates for a provider + model. */
export function getLlmPricing(
  provider: LlmProviderId,
  model: string,
): { input: number; output: number } {
  return PRICING[provider]?.[model] ?? DEFAULT_RATES;
}

/** Infer the provider from a known model id ("unknown" when unrecognized). */
export function inferLlmProvider(model: string): LlmProviderId {
  return MODEL_TO_PROVIDER[model] ?? "GOOGLE";
}
