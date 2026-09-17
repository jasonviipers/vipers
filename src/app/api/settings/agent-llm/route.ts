import { z } from "zod";

import {
  isFleetAgentId,
  listAgentLlmConfigs,
  setAgentLlmProvider,
} from "@/lib/agent-llm-config";
import { useLogger, withEvlog } from "@/lib/evlog";
import { LLM_PROVIDER_IDS } from "@/lib/llm-credentials";
import { requireWriteAccess } from "@/lib/route-auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/settings/agent-llm — per-agent LLM provider overrides.
 *
 * Readable by any authenticated identity (demo included): no credentials
 * are exposed, only which agent is pinned to which provider.
 */
export const GET = withEvlog(async () => {
  const logger = useLogger();
  logger.set({ integration: "settings" });

  const agents = await listAgentLlmConfigs();
  logger.set({ agentCount: agents.length });
  return Response.json({ agents });
});

const agentLlmSchema = z.object({
  agentId: z.string().min(1),
  /** A provider id or null to clear the override (inherit fleet default). */
  provider: z.enum(LLM_PROVIDER_IDS).nullable(),
});

/**
 * PUT /api/settings/agent-llm — set/clear the LLM provider override for one
 * agent. Write access only (demo key → 403). The override takes effect on
 * the next agent call; the model-resolution cache is invalidated here.
 */
export const PUT = withEvlog(async (request: Request) => {
  const logger = useLogger();
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

  const { agentId, provider } = parsed.data;
  if (!isFleetAgentId(agentId)) {
    return Response.json(
      { error: `unknown fleet agent: ${agentId}` },
      { status: 400 },
    );
  }

  await setAgentLlmProvider(agentId, provider);
  logger.set({
    agentId,
    audit: provider
      ? "agent_llm_provider_override"
      : "agent_llm_provider_clear",
    provider: provider ?? "inherit-fleet",
  });
  return Response.json({ agentId, provider });
});
