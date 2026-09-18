import { z } from "zod";

import { BROKER_IDS, type BrokerId } from "@/channels/broker/registry";
import {
  type BrokerMode,
  deleteBrokerCredentials,
  getBrokerCredentials,
  saveBrokerCredentials,
  updateBrokerSettings,
} from "@/lib/broker-credentials";
import { invalidateBrokerHealth } from "@/lib/broker-health";
import { getLogger, withEvlog } from "@/lib/evlog";
import { requireWriteAccess } from "@/lib/route-auth";

export const dynamic = "force-dynamic";

/** Parse + validate the ?broker= query param; defaults to OKX when absent. */
function parseBrokerId(request: Request): BrokerId | null {
  const candidate = new URL(request.url).searchParams.get("broker");
  if (candidate === null) {
    return "okx";
  }
  return (BROKER_IDS as readonly string[]).includes(candidate)
    ? (candidate as BrokerId)
    : null;
}

/** Credential field schema; the passphrase is only required for OKX. */
function upsertSchema(brokerId: BrokerId) {
  const requiresPassphrase = brokerId === "okx";
  return z.object({
    apiKey: z.string().trim().min(16).max(128),
    mode: z.enum(["demo", "live"]),
    passphrase: requiresPassphrase
      ? z.string().trim().min(1).max(128)
      : z.string().trim().max(128).optional(),
    region: z.enum(["default", "eea", "us"]),
    secret: z.string().trim().min(16).max(128),
  });
}

const patchSchema = z.object({
  mode: z.enum(["demo", "live"]).optional(),
  region: z.enum(["default", "eea", "us"]).optional(),
});

const modeParamSchema = z.enum(["demo", "live"]);

function mask(key: string): string {
  if (key.length <= 8) {
    return "••••";
  }
  return `${key.slice(0, 3)}…${key.slice(-4)}`;
}

/**
 * GET /api/broker/credentials?broker=okx|alpaca — masked connection summary
 * for the settings UI (never returns plaintext credentials). Reports BOTH
 * mode slots plus which one is active, so the UI can show demo and live
 * setups side by side and make the switch a first-class action.
 */
export const GET = withEvlog(async (request: Request) => {
  const logger = getLogger();
  logger.set({ integration: "broker" });

  const brokerId = parseBrokerId(request);
  if (!brokerId) {
    return Response.json(
      { error: `unknown broker: expected ${BROKER_IDS.join(" or ")}` },
      { status: 400 },
    );
  }
  logger.set({ brokerId });

  const stored = await getBrokerCredentials(brokerId);
  return Response.json({
    activeMode: stored?.mode ?? null,
    configured: stored !== null,
    credentials: stored
      ? {
          apiKeyHint: mask(stored.apiKey),
          mode: stored.mode,
          // Passphrase is optional per-broker (OKX has one; Alpaca does
          // not) — an absent passphrase simply has no hint.
          passphraseHint:
            stored.passphrase === undefined ? null : mask(stored.passphrase),
          region: stored.region,
          secretHint: mask(stored.secret),
        }
      : null,
  });
});

/**
 * PUT /api/broker/credentials?broker=okx|alpaca — save ONE mode's broker
 * credentials entered in the /settings UI (the other mode's stored slot is
 * untouched — that is what makes "add live without killing demo" possible).
 * The saved slot becomes active. Stored server-side, encrypted at rest;
 * write-access only.
 */
export const PUT = withEvlog(async (request: Request) => {
  const logger = getLogger();
  logger.set({ integration: "broker" });

  const auth = requireWriteAccess(request);
  if (!auth.ok) {
    return auth.response;
  }

  const brokerId = parseBrokerId(request);
  if (!brokerId) {
    return Response.json(
      { error: `unknown broker: expected ${BROKER_IDS.join(" or ")}` },
      { status: 400 },
    );
  }
  logger.set({ brokerId });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const parsed = upsertSchema(brokerId).safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "invalid credential payload", detail: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    await saveBrokerCredentials(brokerId, parsed.data);
  } catch (error) {
    // Storage/encryption failures (e.g. an invalid SECRET_BOX_KEY) must
    // not surface as an opaque 500 — the operator needs the actual cause.
    logger.error(
      error instanceof Error
        ? error
        : new Error("broker credential save failed"),
    );
    return Response.json(
      {
        error: "failed to store credentials",
        detail:
          error instanceof Error
            ? error.message
            : "unknown server-side storage error",
      },
      { status: 500 },
    );
  }
  invalidateBrokerHealth(brokerId);
  logger.set({
    audit: "broker_credentials_updated",
    brokerId,
    mode: parsed.data.mode,
  });
  return Response.json({ ok: true, activeMode: parsed.data.mode, brokerId });
});

/**
 * PATCH /api/broker/credentials?broker=okx|alpaca — ACTIVATE a stored mode
 * slot (region updates ride along). The switch never touches either slot's
 * ciphertext: demo → live → demo preserves both setups. Activating a slot
 * with no stored credentials is refused (409) — an empty slot cannot route
 * orders. Write-access only.
 */
export const PATCH = withEvlog(async (request: Request) => {
  const logger = getLogger();
  logger.set({ integration: "broker" });

  const auth = requireWriteAccess(request);
  if (!auth.ok) {
    return auth.response;
  }

  const brokerId = parseBrokerId(request);
  if (!brokerId) {
    return Response.json(
      { error: `unknown broker: expected ${BROKER_IDS.join(" or ")}` },
      { status: 400 },
    );
  }
  logger.set({ brokerId });

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

  try {
    await updateBrokerSettings(brokerId, parsed.data);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "settings update failed";
    if (message.includes("no credentials stored")) {
      return Response.json({ error: message }, { status: 404 });
    }
    if (message.includes("save them before switching")) {
      // The operator asked to activate a slot that was never saved.
      return Response.json({ error: message }, { status: 409 });
    }
    logger.error(
      error instanceof Error
        ? error
        : new Error("broker settings update failed"),
    );
    return Response.json(
      { error: "failed to update broker settings", detail: message },
      { status: 500 },
    );
  }
  invalidateBrokerHealth(brokerId);
  logger.set({
    audit: "broker_settings_updated",
    brokerId,
    keys: Object.keys(parsed.data),
  });
  return Response.json({ ok: true, activeMode: parsed.data.mode ?? null });
});

/**
 * DELETE /api/broker/credentials?broker=okx|alpaca[&mode=demo|live] —
 * remove ONE mode's slot (mode param; the other slot and the active routing
 * are untouched — removing the ACTIVE slot is refused) or the whole broker
 * (no mode: full disconnect, orders fall back to the paper book).
 * Write-access only.
 */
export const DELETE = withEvlog(async (request: Request) => {
  const logger = getLogger();
  logger.set({ integration: "broker" });

  const auth = requireWriteAccess(request);
  if (!auth.ok) {
    return auth.response;
  }

  const brokerId = parseBrokerId(request);
  if (!brokerId) {
    return Response.json(
      { error: `unknown broker: expected ${BROKER_IDS.join(" or ")}` },
      { status: 400 },
    );
  }
  logger.set({ brokerId });

  const modeParam = new URL(request.url).searchParams.get("mode");
  let mode: BrokerMode | undefined;
  if (modeParam !== null) {
    const parsedMode = modeParamSchema.safeParse(modeParam);
    if (!parsedMode.success) {
      return Response.json(
        { error: "invalid mode: expected demo or live" },
        { status: 400 },
      );
    }
    mode = parsedMode.data;
  }

  try {
    await deleteBrokerCredentials(brokerId, mode);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "credential delete failed";
    if (message.includes("cannot remove the active")) {
      return Response.json({ error: message }, { status: 409 });
    }
    logger.error(
      error instanceof Error
        ? error
        : new Error("broker credential delete failed"),
    );
    return Response.json(
      { error: "failed to delete credentials", detail: message },
      { status: 500 },
    );
  }
  invalidateBrokerHealth(brokerId);
  logger.set({
    audit: "broker_credentials_deleted",
    brokerId,
    ...(mode ? { slot: mode } : {}),
  });
  return Response.json({ ok: true });
});
