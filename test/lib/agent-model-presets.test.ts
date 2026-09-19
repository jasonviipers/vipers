import { describe, expect, it } from "bun:test";
import { agentConfigs } from "@/ai/agents/config";
import {
  AGENT_MODEL_PRESETS,
  assertPresetsValid,
  getAgentModelPreset,
} from "@/lib/agent-model-presets";
import {
  LLM_PROVIDER_IDS,
  PROVIDER_MODEL_CATALOG,
} from "@/lib/llm-credentials";

/**
 * Recommended per-agent model presets: every fleet agent must have one, its
 * model must exist in its provider's catalog, and the validity guard must
 * catch drift. These are the defaults the fleet runs on out of the box.
 */
describe("agent model presets", () => {
  it("defines a preset for every fleet agent", () => {
    for (const config of agentConfigs) {
      const preset = getAgentModelPreset(config.id);
      expect(preset).toBeDefined();
      expect(preset?.provider).toBe("OLLAMA");
    }
  });

  it("references only models present in the provider catalog", () => {
    for (const preset of AGENT_MODEL_PRESETS) {
      expect(PROVIDER_MODEL_CATALOG[preset.provider]).toContain(preset.model);
    }
  });

  it("passes the fail-fast validity guard", () => {
    expect(() =>
      assertPresetsValid(
        PROVIDER_MODEL_CATALOG,
        agentConfigs.map((c) => c.id),
      ),
    ).not.toThrow();
  });

  it("guard rejects a model absent from the catalog", () => {
    const broken = {
      ANTHROPIC: ["x"],
      DEEPSEEK: ["x"],
      GOOGLE: ["x"],
      OLLAMA: ["not-a-model"],
      OPENAI: ["x"],
      XAI: ["x"],
    } as unknown as typeof PROVIDER_MODEL_CATALOG;
    expect(() =>
      assertPresetsValid(
        broken,
        agentConfigs.map((c) => c.id),
      ),
    ).toThrow(/unknown model/);
  });

  it("guard rejects a fleet agent without a preset", () => {
    expect(() =>
      assertPresetsValid(PROVIDER_MODEL_CATALOG, ["ghost-agent"]),
    ).toThrow(/no agent model preset/);
  });

  it("preset models are distinct across roles (heterogeneous fleet)", () => {
    const models = AGENT_MODEL_PRESETS.map((p) => p.model);
    // Sentiment + technical share the fast tier is fine, but the set must
    // not collapse to a single model for the whole fleet.
    expect(new Set(models).size).toBeGreaterThan(1);
  });

  it("all preset providers are known provider ids", () => {
    for (const preset of AGENT_MODEL_PRESETS) {
      expect(LLM_PROVIDER_IDS).toContain(preset.provider);
    }
  });
});
