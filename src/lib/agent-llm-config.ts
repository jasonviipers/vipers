import { and, eq } from "drizzle-orm";

import { agentConfigs } from "@/ai/agents/config";
import { db } from "@/db";
import { agentLlmConfigs } from "@/db/schema/trading";
import { isLlmProviderId, type LlmProviderId } from "@/lib/llm-credentials";

/**
 * Per-agent LLM provider overrides (agent_llm_configs).
 *
 * Every fleet agent normally inherits the operator's DEFAULT LLM PROVIDER
 * (runtime_settings). A row here pins ONE agent to a specific provider so
 * the fleet can run heterogeneous models — e.g. PULSE_READER (sentiment)
 * on GOOGLE while CHART_SCOUT (technical analysis) runs OPENAI. Written
 * through GET/PUT /api/settings/agent-llm from the /settings UI.
 *
 * Resolution: getProviderForAgent() in lib/llm-model.ts reads this table
 * (cached) and falls back to the fleet default when no row exists.
 */

export interface AgentLlmSummary {
  /** The fleet agent id, e.g. "sentiment-agent". */
  agentId: string;
  /** Display codename when the config defines one, else the id. */
  codename: string;
  /** Explicit per-agent override, or null when inheriting the fleet default. */
  providerOverride: LlmProviderId | null;
  /** Display team of the agent (SENTIMENT / ANALYSIS / RISK / EXECUTION / COORDINATION). */
  team: string;
}

/** All per-agent LLM overrides merged with the fleet identity catalog. */
export async function listAgentLlmConfigs(): Promise<AgentLlmSummary[]> {
  let overrides = new Map<string, LlmProviderId>();
  try {
    const rows = await db.select().from(agentLlmConfigs);
    for (const row of rows) {
      if (isLlmProviderId(row.provider)) {
        overrides.set(row.agentId, row.provider);
      }
    }
  } catch {
    // DB unreachable — serve the catalog with no overrides rather than fail
    // the settings page; providers still resolve to the fleet default.
    overrides = new Map();
  }

  return agentConfigs.map((config) => ({
    agentId: config.id,
    codename: config.codename ?? config.id,
    providerOverride: overrides.get(config.id) ?? null,
    team: config.team,
  }));
}

/**
 * Validate that an agent id exists in the fleet identity catalog so the API
 * never writes an override for a non-existent agent.
 */
export function isFleetAgentId(agentId: string): boolean {
  return agentConfigs.some((config) => config.id === agentId);
}

/**
 * Upsert (or clear) the provider override for one agent. `provider: null`
 * removes any override so the agent inherits the fleet default again.
 * Invalidates the model-resolution cache (invalidateActiveProviderCache).
 */
export async function setAgentLlmProvider(
  agentId: string,
  provider: LlmProviderId | null,
): Promise<void> {
  if (provider) {
    await db
      .insert(agentLlmConfigs)
      .values({ agentId, provider, updatedAt: new Date() })
      .onConflictDoUpdate({
        set: { provider, updatedAt: new Date() },
        target: agentLlmConfigs.agentId,
      });
  } else {
    await db
      .delete(agentLlmConfigs)
      .where(and(eq(agentLlmConfigs.agentId, agentId)));
  }

  const { invalidateActiveProviderCache } = await import("@/lib/llm-model");
  invalidateActiveProviderCache();
}
