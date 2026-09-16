import { z } from "zod";
import {
  deleteBrokerCredentials,
  getBrokerCredentials,
  saveBrokerCredentials,
  updateBrokerSettings,
} from "@/lib/broker-credentials";
import { invalidateBrokerHealth } from "@/lib/broker-health";
import { useLogger, withEvlog } from "@/lib/evlog";
import { requireWriteAccess } from "@/lib/route-auth";

export const dynamic = "force-dynamic";

const upsertSchema = z.object({
  apiKey: z.string().trim().min(16).max(128),
  mode: z.enum(["demo", "live"]),
  passphrase: z.string().trim().min(1).max(128),
  region: z.enum(["default", "eea", "us"]),
  secret: z.string().trim().min(16).max(128),
});

const patchSchema = z.object({
  mode: z.enum(["demo", "live"]).optional(),
  region: z.enum(["default", "eea", "us"]).optional(),
});

function mask(key: string): string {
  if (key.length <= 8) {
    return "••••";
  }
  return `${key.slice(0, 3)}…${key.slice(-4)}`;
}

/**
 * GET /api/broker/credentials — masked connection summary for the settings
 * UI (never returns plaintext credentials).
 */
export const GET = withEvlog(async () => {
  const logger = useLogger();
  logger.set({ integration: "broker" });

  const stored = await getBrokerCredentials("okx");
  return Response.json({
    configured: stored !== null,
    credentials: stored
      ? {
          apiKeyHint: mask(stored.apiKey),
          mode: stored.mode,
          passphraseHint: mask(stored.passphrase),
          region: stored.region,
          secretHint: mask(stored.secret),
        }
      : null,
  });
});

/**
 * PUT /api/broker/credentials — save OKX credentials entered in the
 * /settings UI. Stored server-side, encrypted at rest; write-access only.
 */
export const PUT = withEvlog(async (request: Request) => {
  const logger = useLogger();
  logger.set({ integration: "broker" });

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

  const parsed = upsertSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "invalid credential payload", detail: parsed.error.flatten() },
      { status: 400 },
    );
  }

  await saveBrokerCredentials("okx", parsed.data);
  invalidateBrokerHealth("okx");
  logger.set({
    audit: "broker_credentials_updated",
    brokerId: "okx",
    mode: parsed.data.mode,
  });
  return Response.json({ ok: true });
});

/**
 * PATCH /api/broker/credentials — update EXECUTION MODE / REGION only,
 * keeping the stored secrets. One-click fix for OKX's 50101
 * key/environment mismatch (demo key saved under LIVE or vice versa) that
 * would otherwise require re-typing all three secrets. Write-access only.
 */
export const PATCH = withEvlog(async (request: Request) => {
  const logger = useLogger();
  logger.set({ integration: "broker" });

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

  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "invalid settings payload", detail: parsed.error.flatten() },
      { status: 400 },
    );
  }
  if (!parsed.data.mode && !parsed.data.region) {
    return Response.json(
      { error: "nothing to update: provide mode and/or region" },
      { status: 400 },
    );
  }

  const stored = await getBrokerCredentials("okx");
  if (!stored) {
    return Response.json(
      { error: "no credentials stored; save credentials first" },
      { status: 404 },
    );
  }

  await updateBrokerSettings("okx", parsed.data);
  invalidateBrokerHealth("okx");
  logger.set({
    audit: "broker_settings_updated",
    brokerId: "okx",
    keys: Object.keys(parsed.data),
  });
  return Response.json({ ok: true });
});

/**
 * DELETE /api/broker/credentials — disconnect the broker by removing its
 * stored credentials (orders fall back to the paper book). Write-access
 * only.
 */
export const DELETE = withEvlog(async (request: Request) => {
  const logger = useLogger();
  logger.set({ integration: "broker" });

  const auth = requireWriteAccess(request);
  if (!auth.ok) {
    return auth.response;
  }

  await deleteBrokerCredentials("okx");
  invalidateBrokerHealth("okx");
  logger.set({ audit: "broker_credentials_deleted", brokerId: "okx" });
  return Response.json({ ok: true });
});
