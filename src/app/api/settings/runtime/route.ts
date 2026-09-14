import { useLogger, withEvlog } from "@/lib/evlog";
import { requireWriteAccess } from "@/lib/route-auth";
import {
  getRuntimeSettings,
  runtimeSettingsSchema,
  updateRuntimeSettings,
} from "@/lib/runtime-settings";

export const dynamic = "force-dynamic";

/**
 * GET /api/settings/runtime — the server-enforced operator settings.
 * Read endpoint; mirrors the pipeline-enforcing values back to the UI.
 */
export const GET = withEvlog(async () => {
  const logger = useLogger();
  logger.set({ integration: "settings" });

  const settings = await getRuntimeSettings();
  return Response.json(settings);
});

/**
 * PUT /api/settings/runtime — update the server-enforced operator settings.
 *
 * Write-access only (demo key → 403). These values gate the live trading
 * pipeline: consensus quorum, daily-loss cap, max open positions and debug
 * mode. Zod-validated; the effective settings are echoed back.
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

  const parsed = runtimeSettingsSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "invalid settings payload", detail: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const settings = await updateRuntimeSettings(parsed.data);
  logger.set({ audit: "runtime_settings_updated", keys: Object.keys(parsed.data) });
  return Response.json(settings);
});
