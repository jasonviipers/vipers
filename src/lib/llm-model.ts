import { createAnthropic } from "@ai-sdk/anthropic";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createXai } from "@ai-sdk/xai";
import { createOllama } from "ai-sdk-ollama";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { agentLlmConfigs } from "@/db/schema/trading";
import {
  assertPresetsValid,
  getAgentModelPreset,
} from "@/lib/agent-model-presets";
import { log } from "@/lib/evlog";
import {
  getLlmApiKey,
  type LlmProviderId,
  PROVIDER_MODEL_CATALOG,
} from "@/lib/llm-credentials";
import { getRuntimeSettings } from "@/lib/runtime-settings";

// Fail fast at boot if a preset references a model missing from its
// provider's catalog, or a fleet agent lacks a preset — a silent typo would
// otherwise surface only as a runtime model-resolution failure.
assertPresetsValid(PROVIDER_MODEL_CATALOG, [
  "sentiment-agent",
  "technical-analysis-agent",
  "reasoning-analysis-agent",
  "risk-agent",
  "order-executor-agent",
  "orchestrator-agent",
]);

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

/**
 * Default model per provider when no per-agent override is set (small/fast
 * tiers — pipeline latency matters). The full per-provider catalog lives in
 * lib/llm-credentials.ts (PROVIDER_MODEL_CATALOG); each entry here is the
 * first/default of that provider's catalog.
 */
const PROVIDER_MODELS: Record<LlmProviderId, string> = {
  ANTHROPIC: "claude-haiku-4-5",
  DEEPSEEK: "deepseek-chat",
  // gemini-2.5-flash is retired for new API keys (404 at call time), and
  // hardcoding a numbered version rots (the 3.6 id the error suggests does
  // not exist for this key). "gemini-flash-latest" is Google's maintained
  // alias that always resolves to the current fast tier.
  GOOGLE: "gemini-flash-latest",
  OLLAMA: "glm-5.3-flash",
  OPENAI: "gpt-4.1-mini",
  XAI: "grok-4-fast",
};

/** Ollama Cloud host; the apiKey goes in the Authorization: Bearer header. */
const OLLAMA_CLOUD_BASE_URL = "https://ollama.com/api";

const FALLBACK_PROVIDER: LlmProviderId = "GOOGLE";

let cachedProvider: { value: LlmProviderId; expiresAt: number } | null = null;
const PROVIDER_TTL_MS = 10_000;

/** The operator's DEFAULT LLM PROVIDER (short TTL cache). */
async function getActiveProvider(): Promise<LlmProviderId> {
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
    value === "DEEPSEEK" ||
    value === "OLLAMA"
  );
}

/** Invalidate the provider cache after a settings write. */
export function invalidateActiveProviderCache(): void {
  cachedProvider = null;
  agentProviderCache.clear();
}

const agentProviderCache = new Map<
  string,
  {
    value: { model: string | null; provider: LlmProviderId } | null;
    expiresAt: number;
  }
>();

/**
 * Resolve the provider + optional model for a specific fleet agent.
 *
 * Priority: an explicit per-agent override (agent_llm_configs row, set in
 * /settings) wins; otherwise the agent's RECOMMENDED PRESET applies
 * (each agent gets its own role-appropriate Ollama model — see
 * lib/agent-model-presets.ts); only with neither does the agent inherit
 * the operator's fleet DEFAULT LLM PROVIDER. A missing or corrupt DB
 * degrades to the preset/fleet default, so a config read failure never
 * breaks an agent call.
 */
async function getProviderForAgent(
  agentId: string,
): Promise<{ model: string | null; provider: LlmProviderId } | null> {
  const cached = agentProviderCache.get(agentId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }
  let value: { model: string | null; provider: LlmProviderId } | null = null;
  try {
    const [row] = await db
      .select({
        model: agentLlmConfigs.model,
        provider: agentLlmConfigs.provider,
      })
      .from(agentLlmConfigs)
      .where(eq(agentLlmConfigs.agentId, agentId))
      .limit(1);
    if (row && isValidProvider(row.provider)) {
      value = { model: row.model ?? null, provider: row.provider };
    }
  } catch {
    // DB unreachable — fall through to the preset / fleet default.
  }
  if (!value) {
    // No explicit override: the recommended preset gives each agent its own
    // model out of the box (all presets run OLLAMA).
    const preset = getAgentModelPreset(agentId);
    if (preset) {
      value = { model: preset.model, provider: preset.provider };
    }
  }
  agentProviderCache.set(agentId, {
    expiresAt: Date.now() + PROVIDER_TTL_MS,
    value,
  });
  return value;
}

/**
 * Build a language-model instance for a specific provider using its
 * resolved key; null when no key is available for that provider. An
 * optional `modelOverride` pins a specific model from the provider's
 * catalog (PROVIDER_MODEL_CATALOG) instead of the default — unknown ids are
 * dropped to the default (defense in depth: the API already rejects them at
 * write time, so by here an unknown id means an out-of-band write).
 */
async function buildModelForProvider(
  provider: LlmProviderId,
  modelOverride?: string,
) {
  const apiKey = await getLlmApiKey(provider);
  if (!apiKey) {
    return null;
  }
  return createLanguageModel(provider, apiKey, modelOverride);
}

function createLanguageModel(
  provider: LlmProviderId,
  apiKey: string,
  modelOverride?: string,
) {
  const model =
    modelOverride && PROVIDER_MODEL_CATALOG[provider].includes(modelOverride)
      ? modelOverride
      : PROVIDER_MODELS[provider];
  switch (provider) {
    case "ANTHROPIC":
      return createAnthropic({ apiKey })(model);
    case "DEEPSEEK":
      return createDeepSeek({ apiKey })(model);
    case "GOOGLE":
      return createGoogleGenerativeAI({ apiKey })(model);
    case "OLLAMA":
      return createOllama({
        apiKey,
        baseURL: OLLAMA_CLOUD_BASE_URL,
      })(model);
    case "OPENAI":
      return createOpenAI({ apiKey })(model);
    case "XAI":
      return createXai({ apiKey })(model);
  }
}

/**
 * Resolve the model for the active provider, degrading through the
 * fallback chain when keys are missing. Never returns null: the last
 * resort is the Google env key, matching pre-refactor behavior.
 */
export interface ActiveModelInfo {
  /** Non-null: resolveActiveModelInfo throws when no provider can resolve. */
  model: NonNullable<Awaited<ReturnType<typeof buildModelForProvider>>>;
  /** Which provider the resolved model actually runs on. */
  provider: LlmProviderId;
  /** True when the active provider had no key and the fallback was used. */
  usedFallback: boolean;
}

/**
 * Resolve a model through the provider fallback chain, reporting WHICH
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
  const override = agentId ? await getProviderForAgent(agentId) : null;
  const active = override?.provider ?? (await getActiveProvider());

  const preferred = await buildModelForProvider(
    active,
    override?.model ?? undefined,
  );
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
