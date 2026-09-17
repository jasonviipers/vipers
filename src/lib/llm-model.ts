import { createAnthropic } from "@ai-sdk/anthropic";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createXai } from "@ai-sdk/xai";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { agentLlmConfigs } from "@/db/schema/trading";
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
    if (isValidProvider(settings.defaultLlmProvider)) {
      value = settings.defaultLlmProvider;
    }
  } catch {
    // DB unreachable — keep the fallback provider.
  }
  cachedProvider = { expiresAt: Date.now() + PROVIDER_TTL_MS, value };
  return value;
}

function isValidProvider(value: string): value is LlmProviderId {
  return (
    value === "OPENAI" ||
    value === "ANTHROPIC" ||
    value === "GOOGLE" ||
    value === "XAI" ||
    value === "DEEPSEEK"
  );
}

/** Invalidate the provider cache after a settings write. */
export function invalidateActiveProviderCache(): void {
  cachedProvider = null;
  agentProviderCache.clear();
}

const agentProviderCache = new Map<
  string,
  { value: LlmProviderId | null; expiresAt: number }
>();

/**
 * Resolve the provider for a specific fleet agent. A per-agent override
 * (agent_llm_configs row, set in /settings) wins; otherwise the agent
 * inherits the operator's DEFAULT LLM PROVIDER. Null rows never override —
 * the fleet default still applies. A missing or corrupt DB falls back to
 * the fleet default, so a config read failure never breaks an agent call.
 */
export async function getProviderForAgent(
  agentId: string,
): Promise<LlmProviderId | null> {
  const cached = agentProviderCache.get(agentId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }
  let value: LlmProviderId | null = null;
  try {
    const [row] = await db
      .select({ provider: agentLlmConfigs.provider })
      .from(agentLlmConfigs)
      .where(eq(agentLlmConfigs.agentId, agentId))
      .limit(1);
    if (row && isValidProvider(row.provider)) {
      value = row.provider;
    }
  } catch {
    // DB unreachable — fall through to the fleet default.
  }
  agentProviderCache.set(agentId, {
    expiresAt: Date.now() + PROVIDER_TTL_MS,
    value,
  });
  return value;
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
  const { model } = await resolveActiveModelInfo();
  return model;
}

export interface ActiveModelInfo {
  /** Non-null: resolveActiveModelInfo throws when no provider can resolve. */
  model: NonNullable<Awaited<ReturnType<typeof buildModelForProvider>>>;
  /** Which provider the resolved model actually runs on. */
  provider: LlmProviderId;
  /** True when the active provider had no key and the fallback was used. */
  usedFallback: boolean;
}

/**
 * Same resolution chain as resolveActiveModel, but also reports WHICH
 * provider the model actually runs on and the configured model id — the
 * metadata decision records need (a silent fallback must not be recorded
 * as the operator's chosen provider).
 *
 * Pass `agentId` to respect a per-agent provider override (set in
 * /settings → AGENT CONFIGURATION); omitted, the fleet-wide default –
 * operator's DEFAULT LLM PROVIDER – applies, preserving callers that
 * resolve tooling models rather than an agent's.
 */
export async function resolveActiveModelInfo(
  agentId?: string,
): Promise<ActiveModelInfo> {
  const active = agentId
    ? ((await getProviderForAgent(agentId)) ?? (await getActiveProvider()))
    : await getActiveProvider();

  const preferred = await buildModelForProvider(active);
  if (preferred) {
    return { model: preferred, provider: active, usedFallback: false };
  }

  const fallback = await buildModelForProvider(FALLBACK_PROVIDER);
  if (fallback) {
    log.warn({
      activeProvider: active,
      message: "active LLM provider has no key — fell back to GOOGLE",
    });
    return {
      model: fallback,
      provider: FALLBACK_PROVIDER,
      usedFallback: true,
    };
  }

  throw new Error(
    "No LLM API key available: add one in /settings → AGENT CONFIGURATION (or set the provider env var).",
  );
}
