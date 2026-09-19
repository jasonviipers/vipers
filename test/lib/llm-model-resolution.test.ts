import { beforeEach, describe, expect, it, mock } from "bun:test";
import { AGENT_MODEL_PRESETS } from "@/lib/agent-model-presets";

/**
 * Per-agent model resolution priority (lib/llm-model.ts):
 *
 *   explicit agent_llm_configs override  >  recommended preset  >  fleet default
 *
 * The DB layer and settings store are mocked; what's under test is the
 * priority logic itself — the operator's override wins, the preset applies
 * when nothing is pinned, and the fallback chain still holds.
 */

let overrideRows: Record<
  string,
  { model: string | null; provider: string } | undefined
> = {};

mock.module("@/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => {
            const keys = Object.keys(overrideRows);
            const single =
              keys.length === 1 ? overrideRows[keys[0]] : undefined;
            return single ? [single] : [];
          },
        }),
      }),
    }),
  },
}));

mock.module("@/lib/runtime-settings", () => ({
  getRuntimeSettings: async () => ({
    activeBrokerId: "okx",
    automationEnabled: true,
    automationIntervalSec: 300,
    canaryLossBudgetPct: null,
    canaryMaxAllocationPct: null,
    consensusQuorum: 50,
    debugMode: false,
    defaultLlmProvider: "GOOGLE",
    heartbeatInterval: 30,
    maxDailyLossPct: 3,
    maxOpenPositions: 10,
    rollbackMaxDrawdownPct: null,
    rollbackMaxLossPct: null,
  }),
  hashRuntimeSettings: async () => "hash",
}));

const keyStore: Record<string, string | null> = {
  ANTHROPIC: "sk-ant-test",
  DEEPSEEK: "sk-ds-test",
  GOOGLE: "google-env-key",
  OLLAMA: "ollama-key",
  OPENAI: "sk-openai-test",
  XAI: "sk-xai-test",
};

mock.module("@/lib/llm-credentials", () => ({
  getLlmApiKey: async (provider: string) => keyStore[provider] ?? null,
  isLlmModelForProvider: () => true,
  LLM_PROVIDER_IDS: [
    "OPENAI",
    "ANTHROPIC",
    "GOOGLE",
    "XAI",
    "DEEPSEEK",
    "OLLAMA",
  ],
  PROVIDER_MODEL_CATALOG: {
    ANTHROPIC: ["claude-haiku-4-5"],
    DEEPSEEK: ["deepseek-chat"],
    GOOGLE: ["gemini-flash-latest"],
    // Derived from the presets so the import-time validity guard in
    // llm-model.ts always passes here — the mock catalog can never drift
    // from the preset models.
    OLLAMA: [
      ...new Set(
        AGENT_MODEL_PRESETS.filter((p) => p.provider === "OLLAMA").map(
          (p) => p.model,
        ),
      ),
    ],
    OPENAI: ["gpt-4.1-mini"],
    XAI: ["grok-4-fast"],
  },
}));

const { invalidateActiveProviderCache, resolveActiveModelInfo } = await import(
  "@/lib/llm-model"
);

beforeEach(() => {
  overrideRows = {};
  // The per-agent resolution cache (10s TTL) would leak the preset value
  // between tests for the same agent id — invalidate like the API does on
  // a settings write.
  invalidateActiveProviderCache();
});

describe("resolveActiveModelInfo with agent presets", () => {
  it("uses the agent's recommended preset when no override exists", async () => {
    const info = await resolveActiveModelInfo("sentiment-agent");
    // Preset: OLLAMA / glm-5.3-flash — even though the fleet default is
    // GOOGLE in this test, the preset wins for per-agent identity.
    expect(info.provider).toBe("OLLAMA");
    expect(info.usedFallback).toBe(false);
  });

  it("an explicit override wins over the preset", async () => {
    overrideRows["sentiment-agent"] = { model: null, provider: "OPENAI" };
    const info = await resolveActiveModelInfo("sentiment-agent");
    expect(info.provider).toBe("OPENAI");
  });

  it("an explicit override with model wins over the preset", async () => {
    overrideRows["risk-agent"] = { model: "glm-5.3", provider: "OLLAMA" };
    const info = await resolveActiveModelInfo("risk-agent");
    expect(info.provider).toBe("OLLAMA");
  });

  it("preset provider differs from the fleet default (genuine per-agent identity)", async () => {
    const info = await resolveActiveModelInfo("sentiment-agent");
    // Without the preset the sentiment agent would inherit GOOGLE (the
    // fleet default in this test); the preset must differ from it so this
    // test genuinely exercises preset-vs-default distinction.
    expect(info.provider).not.toBe("GOOGLE");
  });

  it("tooling models (no agentId) still use the fleet default", async () => {
    const info = await resolveActiveModelInfo();
    expect(info.provider).toBe("GOOGLE");
  });
});
