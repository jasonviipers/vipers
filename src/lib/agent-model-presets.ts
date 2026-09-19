import type { LlmProviderId } from "@/lib/llm-credentials";

/**
 * Per-agent RECOMMENDED model presets — the "best default configuration".
 *
 * The fleet is heterogeneous by design: each agent's role dictates its
 * model tier. These presets are the recommended Ollama Cloud model for
 * every fleet member; resolution treats them as defaults-of-record when
 * the operator has not written an explicit override (agent_llm_configs
 * row). Agents with heavier reasoning loads get the flagship reasoning
 * tier; high-frequency, latency-sensitive roles get fast/cheap workhorses.
 *
 * Why presets instead of writing rows: the operator can change or clear an
 * override in /settings at any time; presets keep "not yet customized"
 * distinct from "explicitly pinned", so Reset Defaults never needs to
 * reconstruct DB state.
 */

export interface AgentModelPreset {
  /** The fleet agent id (agentConfigs.id). */
  agentId: string;
  /** Recommended model id (must exist in PROVIDER_MODEL_CATALOG.OLLAMA). */
  model: string;
  /** One-line rationale shown in /settings. */
  rationale: string;
  /** The preset's provider (all presets run on Ollama by default). */
  provider: LlmProviderId;
}

export const AGENT_MODEL_PRESETS: readonly AgentModelPreset[] = [
  {
    agentId: "sentiment-agent",
    model: "glm-5.3-flash",
    provider: "OLLAMA",
    rationale:
      "Highest-frequency role (every pipeline pass); fast/cheap tier keeps cadence.",
  },
  {
    agentId: "technical-analysis-agent",
    model: "deepseek-v4.1-flash",
    provider: "OLLAMA",
    rationale:
      "Numeric/indicator reasoning at high cadence; fast tier with stronger math bias.",
  },
  {
    agentId: "reasoning-analysis-agent",
    model: "glm-5.3",
    provider: "OLLAMA",
    rationale:
      "Produces trade theses — the fleet's deepest reasoning step gets the flagship tier.",
  },
  {
    agentId: "risk-agent",
    model: "gpt-oss:120b",
    provider: "OLLAMA",
    rationale:
      "Gatekeeper: hard validation with a conservative, instruction-tight model.",
  },
  {
    agentId: "order-executor-agent",
    model: "qwen3.5:397b",
    provider: "OLLAMA",
    rationale:
      "Tool-call precision for order lifecycle actions; agentic-tuned tier.",
  },
  {
    agentId: "orchestrator-agent",
    model: "kimi-k3",
    provider: "OLLAMA",
    rationale:
      "Aggregate/summarize/schedule across the fleet; long-context balanced tier.",
  },
] as const;

const PRESETS_BY_AGENT = new Map(
  AGENT_MODEL_PRESETS.map((preset) => [preset.agentId, preset]),
);

/** The recommended preset for one agent, if its id is in the fleet catalog. */
export function getAgentModelPreset(
  agentId: string,
): AgentModelPreset | undefined {
  return PRESETS_BY_AGENT.get(agentId);
}

/**
 * Self-check: every preset's model must exist in its provider's catalog and
 * every fleet agent must have a preset — a typo here would silently break
 * model resolution at runtime, so it fails fast at import instead.
 */
export function assertPresetsValid(
  catalog: Record<LlmProviderId, readonly string[]>,
  fleetAgentIds: readonly string[],
): void {
  for (const preset of AGENT_MODEL_PRESETS) {
    if (!catalog[preset.provider]?.includes(preset.model)) {
      throw new Error(
        `agent model preset for ${preset.agentId} references unknown model "${preset.model}" for provider ${preset.provider}`,
      );
    }
  }
  for (const agentId of fleetAgentIds) {
    if (!PRESETS_BY_AGENT.has(agentId)) {
      throw new Error(
        `no agent model preset defined for fleet agent ${agentId}`,
      );
    }
  }
}
