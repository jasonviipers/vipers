import { z } from "zod";

import { getLogger, withEvlog } from "@/lib/evlog";
import {
  deleteLlmApiKey,
  isLlmProviderId,
  listLlmKeyStatuses,
  saveLlmApiKey,
} from "@/lib/llm-credentials";
import { requireWriteAccess } from "@/lib/route-auth";

export const dynamic = "force-dynamic";

const saveSchema = z.object({
  apiKey: z.string().trim().min(8).max(256),
  label: z.string().trim().max(64).nullable().optional(),
});

const providerSchema = z.object({
  provider: z.string().refine(isLlmProviderId, "unknown provider"),
});

/**
 * GET /api/llm/credentials — per-provider key status for the settings UI.
 * Returns masked hints and the effective source (database/env), never
 * plaintext keys.
 */
export const GET = withEvlog(async () => {
  const logger = getLogger();
  logger.set({ integration: "llm" });

  const providers = await listLlmKeyStatuses();
  return Response.json({ providers });
});

/**
 * PUT /api/llm/credentials — store (encrypted) an API key for a provider.
 * Write-access only (demo key → 403). The key overrides the corresponding
 * env var at model-resolution time.
 */
export const PUT = withEvlog(async (request: Request) => {
  const logger = getLogger();
  logger.set({ integration: "llm" });

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

  const providerParsed = providerSchema.safeParse(body);
  if (!providerParsed.success) {
    return Response.json(
      { error: "unknown provider", detail: providerParsed.error.flatten() },
      { status: 400 },
    );
  }

  const parsed = saveSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "invalid credential payload", detail: parsed.error.flatten() },
      { status: 400 },
    );
  }

  await saveLlmApiKey(
    providerParsed.data.provider as Parameters<typeof saveLlmApiKey>[0],
    {
      apiKey: parsed.data.apiKey,
      label: parsed.data.label ?? null,
    },
  );
  logger.set({
    audit: "llm_key_saved",
    provider: providerParsed.data.provider,
  });
  return Response.json({ ok: true });
});

/**
 * DELETE /api/llm/credentials?provider=OPENAI — remove the stored key;
 * resolution falls back to the env var when present. Write-access only.
 */
export const DELETE = withEvlog(async (request: Request) => {
  const logger = getLogger();
  logger.set({ integration: "llm" });

  const auth = requireWriteAccess(request);
  if (!auth.ok) {
    return auth.response;
  }

  const url = new URL(request.url);
  const provider = url.searchParams.get("provider");
  if (!provider || !isLlmProviderId(provider)) {
    return Response.json(
      {
        error:
          "expected ?provider=<OPENAI|ANTHROPIC|GOOGLE|XAI|DEEPSEEK|OLLAMA>",
      },
      { status: 400 },
    );
  }

  await deleteLlmApiKey(provider);
  logger.set({ audit: "llm_key_deleted", provider });
  return Response.json({ ok: true });
});
