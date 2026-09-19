import { eq } from "drizzle-orm";

import { db } from "@/db";
import { llmCredentials } from "@/db/schema/trading";
import { log } from "@/lib/evlog";
import { openSecret, sealSecret } from "@/lib/secret-box";

/**
 * Server-side LLM provider key store. Keys are entered in the /settings UI
 * and stored encrypted at rest (AES-256-GCM, secret-box) in the
 * llm_credentials table. Keys stored here override environment variables
 * at model-resolution time, so switching providers is a UI action — no
 * redeploy.
 *
 * Plaintext never leaves the server: API surfaces return masked hints.
 */

const CACHE_TTL_MS = 30_000;

/** Provider ids mirror LLM_PROVIDERS in lib/queries/strategies.ts. */
export const LLM_PROVIDER_IDS = [
  "OPENAI",
  "ANTHROPIC",
  "GOOGLE",
  "XAI",
  "DEEPSEEK",
  "OLLAMA",
] as const;

export type LlmProviderId = (typeof LLM_PROVIDER_IDS)[number];

/** Environment variable each provider falls back to. */
const PROVIDER_ENV_KEYS: Record<LlmProviderId, string> = {
  ANTHROPIC: "ANTHROPIC_API_KEY",
  DEEPSEEK: "DEEPSEEK_API_KEY",
  GOOGLE: "GOOGLE_GENERATIVE_AI_API_KEY",
  OLLAMA: "OLLAMA_API_KEY",
  OPENAI: "OPENAI_API_KEY",
  XAI: "XAI_API_KEY",
};

export function isLlmProviderId(value: string): value is LlmProviderId {
  return (LLM_PROVIDER_IDS as readonly string[]).includes(value);
}

/**
 * Per-provider model catalog for the /settings pickers. Only Ollama has a
 * real multi-model surface today (Ollama Cloud serves the list below —
 * verified against https://ollama.com/api/tags); the other providers run a
 * single curated default, so their catalogs are that one-tier entry. The UI
 * lists the catalog for whichever provider is selected; the API rejects any
 * model id not in the selected provider's catalog, so a typo can't wedge an
 * agent at call time.
 */
export const PROVIDER_MODEL_CATALOG: Record<LlmProviderId, readonly string[]> =
  {
    ANTHROPIC: ["claude-haiku-4-5"],
    DEEPSEEK: ["deepseek-chat"],
    GOOGLE: ["gemini-flash-latest"],
    OLLAMA: [
      // Fast/cheap workhorses
      "glm-5.3-flash",
      "deepseek-v4-flash:0731",
      "deepseek-v4.1-flash",
      "gemma4:31b",
      "gpt-oss:20b",
      // Flagship reasoning / agentic
      "glm-5.3",
      "kimi-k3",
      "qwen3.5:397b",
      "minimax-m3",
      "nemotron-3-ultra",
      "gpt-oss:120b",
    ],
    OPENAI: ["gpt-4.1-mini"],
    XAI: ["grok-4-fast"],
  };

/**
 * True when `model` is in the provider's known catalog. An empty/undefined
 * model is valid (inherit the provider default) — only a non-empty unknown id
 * is rejected.
 */
export function isLlmModelForProvider(
  provider: LlmProviderId,
  model: string | null | undefined,
): boolean {
  if (!model) {
    return true;
  }
  return PROVIDER_MODEL_CATALOG[provider].includes(model);
}

export interface LlmKeyStatus {
  /** Masked hint, e.g. "sk-…f3a1" — never the full key. */
  hint: string | null;
  provider: LlmProviderId;
  /** Where the key currently comes from. */
  source: "database" | "env" | null;
}

const cache = new Map<
  LlmProviderId,
  { value: string | null; expiresAt: number }
>();

function invalidate(provider: LlmProviderId): void {
  cache.delete(provider);
}

/** Resolve the working API key for a provider (DB first, env fallback). */
export async function getLlmApiKey(
  provider: LlmProviderId,
): Promise<string | null> {
  const cached = cache.get(provider);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  let value: string | null = null;
  try {
    const [row] = await db
      .select({ apiKeyCipher: llmCredentials.apiKeyCipher })
      .from(llmCredentials)
      .where(eq(llmCredentials.id, provider))
      .limit(1);
    if (row) {
      value = openSecret(row.apiKeyCipher);
    }
  } catch (error) {
    log.error(
      error instanceof Error
        ? error
        : new Error("llm credential lookup failed"),
    );
  }

  if (!value) {
    value = process.env[PROVIDER_ENV_KEYS[provider]]?.trim() || null;
  }

  cache.set(provider, { expiresAt: Date.now() + CACHE_TTL_MS, value });
  return value;
}

function mask(key: string): string {
  if (key.length <= 8) {
    return "••••";
  }
  return `${key.slice(0, 3)}…${key.slice(-4)}`;
}

/**
 * Per-provider status for the settings UI. Reports the effective source
 * (DB row wins over env) and a masked hint.
 */
export async function listLlmKeyStatuses(): Promise<LlmKeyStatus[]> {
  // Per-provider rows are independent; env lookups are already sync, so the
  // DB reads run concurrently and each provider keeps its own error guard.
  return Promise.all(
    LLM_PROVIDER_IDS.map(async (provider) => {
      let dbKey: string | null = null;
      try {
        const [row] = await db
          .select({ apiKeyCipher: llmCredentials.apiKeyCipher })
          .from(llmCredentials)
          .where(eq(llmCredentials.id, provider))
          .limit(1);
        if (row) {
          dbKey = openSecret(row.apiKeyCipher);
        }
      } catch {
        // DB unavailable — env fallback still applies below.
      }
      const envKey = process.env[PROVIDER_ENV_KEYS[provider]]?.trim() || null;
      const effective = dbKey ?? envKey;
      return {
        hint: effective ? mask(effective) : null,
        provider,
        source: dbKey ? "database" : envKey ? "env" : null,
      };
    }),
  );
}

export interface SaveLlmKeyInput {
  apiKey: string;
  label?: string | null;
}

/** Upsert (and re-encrypt) the key row for a provider. */
export async function saveLlmApiKey(
  provider: LlmProviderId,
  input: SaveLlmKeyInput,
): Promise<void> {
  await db
    .insert(llmCredentials)
    .values({
      apiKeyCipher: sealSecret(input.apiKey.trim()),
      id: provider,
      label: input.label?.trim() || null,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      set: {
        apiKeyCipher: sealSecret(input.apiKey.trim()),
        label: input.label?.trim() || null,
        updatedAt: new Date(),
      },
      target: llmCredentials.id,
    });
  invalidate(provider);
}

/** Remove the key row (falls back to the env var if present). */
export async function deleteLlmApiKey(provider: LlmProviderId): Promise<void> {
  await db.delete(llmCredentials).where(eq(llmCredentials.id, provider));
  invalidate(provider);
}
