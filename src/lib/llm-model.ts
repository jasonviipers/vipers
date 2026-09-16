import { createAnthropic } from "@ai-sdk/anthropic";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createXai } from "@ai-sdk/xai";

import { log } from "@/lib/evlog";
import { getLlmApiKey, type LlmProviderId } from "@/lib/llm-credentials";
import { getRuntimeSettings } from "@/lib/runtime-settings";

/**
 * LLM model resolution for the agent fleet.
 *
 * The operator picks a DEFAULT LLM PROVIDER in /settings (runtime_settings
 * row); every AI SDK agent resolves its model dynamically against that
 * setting, so switching providers is a UI action that takes effect on the
 * next agent call — no redeploy.
 *
 * API keys resolve per provider (DB store first, env var fallback). A
 * provider without a resolvable key falls back to the next configured
 * provider, and finally to the env Google key (the historical default), so
 * a misconfigured switch degrades instead of breaking the pipeline.
 */

/** Default model per provider (small/fast tiers — pipeline latency matters). */
const PROVIDER_MODELS: Record<LlmProviderId, string> = {
  ANTHROPIC: "claude-haiku-4-5",
  DEEPSEEK: "deepseek-chat",
  // gemini-2.5-flash is retired for new API keys (404 at call time), and
  // hardcoding a numbered version rots (the 3.6 id the error suggests does
  // not exist for this key). "gemini-flash-latest" is Google's maintained
  // alias that always resolves to the current fast tier.
  GOOGLE: "gemini-flash-latest",
  OPENAI: "gpt-4.1-mini",
  XAI: "grok-4-fast",
};

const FALLBACK_PROVIDER: LlmProviderId = "GOOGLE";

let cachedProvider: { value: LlmProviderId; expiresAt: number } | null = null;
const PROVIDER_TTL_MS = 10_000;

/** The operator's DEFAULT LLM PROVIDER (short TTL cache). */
export async function getActiveProvider(): Promise<LlmProviderId> {
  if (cachedProvider && cachedProvider.expiresAt > Date.now()) {
    return cachedProvider.value;
  }
  let value: LlmProviderId = FALLBACK_PROVIDER;
  try {
    const settings = await getRuntimeSettings();
    if (
      settings.defaultLlmProvider === "OPENAI" ||
      settings.defaultLlmProvider === "ANTHROPIC" ||
      settings.defaultLlmProvider === "GOOGLE" ||
      settings.defaultLlmProvider === "XAI" ||
      settings.defaultLlmProvider === "DEEPSEEK"
    ) {
      value = settings.defaultLlmProvider;
    }
  } catch {
    // DB unreachable — keep the fallback provider.
  }
  cachedProvider = { expiresAt: Date.now() + PROVIDER_TTL_MS, value };
  return value;
}

/** Invalidate the provider cache after a settings write. */
export function invalidateActiveProviderCache(): void {
  cachedProvider = null;
}

/**
 * Build a language-model instance for a specific provider using its
 * resolved key; null when no key is available for that provider.
 */
export async function buildModelForProvider(provider: LlmProviderId) {
  const apiKey = await getLlmApiKey(provider);
  if (!apiKey) {
    return null;
  }
  return createLanguageModel(provider, apiKey);
}

function createLanguageModel(provider: LlmProviderId, apiKey: string) {
  switch (provider) {
    case "ANTHROPIC":
      return createAnthropic({ apiKey })(PROVIDER_MODELS.ANTHROPIC);
    case "DEEPSEEK":
      return createDeepSeek({ apiKey })(PROVIDER_MODELS.DEEPSEEK);
    case "GOOGLE":
      return createGoogleGenerativeAI({ apiKey })(PROVIDER_MODELS.GOOGLE);
    case "OPENAI":
      return createOpenAI({ apiKey })(PROVIDER_MODELS.OPENAI);
    case "XAI":
      return createXai({ apiKey })(PROVIDER_MODELS.XAI);
  }
}

/**
 * Resolve the model for the active provider, degrading through the
 * fallback chain when keys are missing. Never returns null: the last
 * resort is the Google env key, matching pre-refactor behavior.
 */
export async function resolveActiveModel() {
  const active = await getActiveProvider();

  const preferred = await buildModelForProvider(active);
  if (preferred) {
    return preferred;
  }

  const fallback = await buildModelForProvider(FALLBACK_PROVIDER);
  if (fallback) {
    log.warn({
      activeProvider: active,
      message: "active LLM provider has no key — fell back to GOOGLE",
    });
    return fallback;
  }

  throw new Error(
    "No LLM API key available: add one in /settings → AGENT CONFIGURATION (or set the provider env var).",
  );
}
