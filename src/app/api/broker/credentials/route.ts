import { z } from "zod";

import { useLogger, withEvlog } from "@/lib/evlog";
import {
  deleteBrokerCredentials,
  getBrokerCredentials,
  saveBrokerCredentials,
} from "@/lib/broker-credentials";
import { requireWriteAccess } from "@/lib/route-auth";

export const dynamic = "force-dynamic";

const upsertSchema = z.object({
  apiKey: z.string().trim().min(16).max(128),
  mode: z.enum(["demo", "live"]),
  passphrase: z.string().trim().min(1).max(128),
  region: z.enum(["default", "eea", "us"]),
  secret: z.string().trim().min(16).max(128),
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
  logger.set({
    audit: "broker_credentials_updated",
    brokerId: "okx",
    mode: parsed.data.mode,
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
  logger.set({ audit: "broker_credentials_deleted", brokerId: "okx" });
  return Response.json({ ok: true });
});
