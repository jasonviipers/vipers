import { z } from "zod";

import {
  isFleetAgentId,
  listAgentLlmConfigs,
  setAgentLlmProvider,
} from "@/lib/agent-llm-config";
import { AGENT_MODEL_PRESETS } from "@/lib/agent-model-presets";
import { getLogger, withEvlog } from "@/lib/evlog";
import {
  isLlmModelForProvider,
  LLM_PROVIDER_IDS,
  PROVIDER_MODEL_CATALOG,
} from "@/lib/llm-credentials";
import { requireWriteAccess } from "@/lib/route-auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/settings/agent-llm — per-agent LLM provider overrides.
 *
 * Readable by any authenticated identity (demo included): no credentials
 * are exposed, only which agent is pinned to which provider.
 */
export const GET = withEvlog(async () => {
  const logger = getLogger();
  logger.set({ integration: "settings" });

  const agents = await listAgentLlmConfigs();
  logger.set({ agentCount: agents.length });
  return Response.json({
    agents,
    /** Recommended per-agent defaults (each agent gets its own model). */
    presets: AGENT_MODEL_PRESETS,
    providerModels: PROVIDER_MODEL_CATALOG,
  });
});

const agentLlmSchema = z.object({
  agentId: z.string().min(1),
  /** A provider id or null to clear the override (inherit fleet default). */
  provider: z.enum(LLM_PROVIDER_IDS).nullable(),
  /**
   * Optional model from the provider's catalog; null/omitted → provider
   * default. Validated against PROVIDER_MODEL_CATALOG at write time.
   */
  model: z.string().min(1).nullable().optional(),
});

/**
 * PUT /api/settings/agent-llm — set/clear the LLM provider override for one
 * agent. Write access only (demo key → 403). The override takes effect on
 * the next agent call; the model-resolution cache is invalidated here.
 */
export const PUT = withEvlog(async (request: Request) => {
  const logger = getLogger();
  logger.set({ integration: "settings" });

  const auth = requireWriteAccess(request);
  if (!auth.ok) {
    return auth.response;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const parsed = agentLlmSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "invalid agent-llm payload", detail: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { agentId, provider, model } = parsed.data;
  if (!isFleetAgentId(agentId)) {
    return Response.json(
      { error: `unknown fleet agent: ${agentId}` },
      { status: 400 },
    );
  }

  if (provider && model != null && !isLlmModelForProvider(provider, model)) {
    return Response.json(
      {
        error: `unknown model "${model}" for provider ${provider}; expected one of: ${PROVIDER_MODEL_CATALOG[provider].join(", ")}`,
      },
      { status: 400 },
    );
  }

  await setAgentLlmProvider(agentId, provider, model ?? null);
  logger.set({
    agentId,
    audit: provider
      ? "agent_llm_provider_override"
      : "agent_llm_provider_clear",
    model: model ?? "provider-default",
    provider: provider ?? "inherit-fleet",
  });
  return Response.json({ agentId, model: model ?? null, provider });
});
