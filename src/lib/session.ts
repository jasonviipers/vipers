/**
 * Session tokens: short-lived, HMAC-signed, cookie-managed.
 *
 * The browser never sees a permanent secret and never stores one: after the
 * operator's API key is verified once by `/api/auth/validate`, the server
 * mints a signed session token that lives in an HttpOnly cookie. Without
 * the signing key an attacker cannot forge or tamper with it, and because
 * the token expires, a stolen cookie is only useful for a short window.
 *
 * Token format: `v1.<base64url(json payload)>.<hex hmac-sha256>`
 * Payload:      { sid, sub, kind, demo, agentId?, iat, exp }
 *
 * Lifetime model:
 *  - `SESSION_IDLE_TTL_MS` — a request refreshes the token to now + idle TTL,
 *    so the cookie dies after ~15 minutes of inactivity (sliding window).
 *  - `SESSION_MAX_TTL_MS`  — hard ceiling (24h) so a cookie can never be
 *    refreshed forever; after that the operator re-authenticates.
 *
 * The proxy (src/proxy.ts) verifies and refreshes on every API request; route
 * handlers re-verify independently (cheap HMAC) for defense-in-depth, since
 * the proxy is an optimistic gate, not the authorization boundary.
 *
 * Signing key: SESSION_SECRET (raw string or base64). In development a
 * deterministic fallback is derived from DATABASE_URL so a fresh clone works
 * out of the box; production REQUIRES the real key.
 */

import "server-only";

import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

import { safeCommand } from "@/lib/redis";

export const SESSION_COOKIE = "viipers_session";

const SESSION_IDLE_TTL_MS = 15 * 60 * 1000; // 15 min idle
const SESSION_MAX_TTL_MS = 24 * 60 * 60 * 1000; // 24h absolute

const VERSION = "v1";
const REVOKE_PREFIX = "session:revoke:";
const FALLBACK_SALT = "viipers-session-v1";

export interface SessionPayload {
  agentId?: string;
  demo: boolean;
  exp: number; // epoch ms
  iat: number; // epoch ms
  kind: "operator" | "demo" | "agent";
  sid: string; // unique per-login random id
  sub: string; // "operator" | "demo" | "agent:<id>"
}

let cachedKey: Buffer | null = null;

function loadKey(): Buffer {
  if (cachedKey) return cachedKey;

  const raw = process.env.SESSION_SECRET?.trim();
  if (raw) {
    // Accept either a raw secret or a base64 blob (`openssl rand -base64 32`).
    const fromBase64 = Buffer.from(raw, "base64");
    const key = fromBase64.length >= 16 ? fromBase64 : Buffer.from(raw, "utf8");
    if (key.length < 16) {
      throw new Error(
        "SESSION_SECRET must be at least 16 bytes (e.g. `openssl rand -base64 32`)",
      );
    }
    cachedKey = key;
    return cachedKey;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "SESSION_SECRET is required in production — session cookies are signed with it",
    );
  }

  // Dev fallback: deterministic per-database so devs just work.
  const dbUrl = process.env.DATABASE_URL ?? "local";
  cachedKey = createHash("sha256")
    .update(`${FALLBACK_SALT}:${dbUrl}`)
    .digest()
    .slice(0, 32);
  return cachedKey;
}

function sign(encoded: string): string {
  return createHmac("sha256", loadKey()).update(encoded).digest("hex");
}

/** Mint a brand-new session for a verified principal. */
export function mintSession(opts: {
  agentId?: string;
  demo: boolean;
  kind: "operator" | "demo" | "agent";
  sub: string;
}): string {
  const now = Date.now();
  const payload: SessionPayload = {
    sid: randomBytes(18).toString("base64url"),
    sub: opts.sub,
    kind: opts.kind,
    agentId: opts.agentId,
    demo: opts.demo,
    iat: now,
    exp: now + SESSION_IDLE_TTL_MS,
  };
  return encodeSession(payload);
}

/** Encode a session payload into a signed token. */
export function encodeSession(payload: SessionPayload): string {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url",
  );
  return `${VERSION}.${body}.${sign(`${VERSION}.${body}`)}`;
}

/**
 * Verify a token: shape, signature (constant-time), expiry. Returns the
 * payload on success, null on any failure (tampered, expired, forged,
 * malformed).
 */
export function verifySessionToken(
  token: string | null | undefined,
): SessionPayload | null {
  if (!token) return null;

  const [version, body, sig, ...extra] = token.split(".");
  if (version !== VERSION || !body || !sig || extra.length > 0) {
    return null;
  }

  const expected = sign(`${VERSION}.${body}`);
  const sigBuf = Buffer.from(sig, "hex");
  const expectedBuf = Buffer.from(expected, "hex");
  if (
    sigBuf.length !== expectedBuf.length ||
    !timingSafeEqual(sigBuf, expectedBuf)
  ) {
    return null;
  }

  let payload: SessionPayload;
  try {
    payload = JSON.parse(
      Buffer.from(body, "base64url").toString("utf8"),
    ) as SessionPayload;
  } catch {
    return null;
  }

  if (
    typeof payload?.exp !== "number" ||
    typeof payload?.iat !== "number" ||
    typeof payload?.sub !== "string" ||
    typeof payload?.sid !== "string" ||
    typeof payload?.demo !== "boolean" ||
    !["operator", "demo", "agent"].includes(payload.kind) ||
    payload.exp <= Date.now() ||
    payload.exp < payload.iat ||
    payload.sid.length < 8
  ) {
    return null;
  }
  return payload;
}

/**
 * Re-mint a session for the same principal with a fresh idle expiry, capped
 * by the absolute max TTL so a token can never be refreshed beyond 24h.
 */
export function refreshSession(payload: SessionPayload): SessionPayload {
  const now = Date.now();
  return {
    ...payload,
    exp: Math.min(now + SESSION_IDLE_TTL_MS, payload.iat + SESSION_MAX_TTL_MS),
  };
}

// -- Revocation ------------------------------------------------------------
// Best-effort, Redis-backed: a revoked sid is rejected by the proxy until the
// token naturally expires. If Redis is absent or down the check fails open —
// availability beats a marginal revocation guarantee here. Signature + short
// TTL remain the primary control.

/** Revoke a session id so the proxy rejects it until its token expires. */
export async function revokeSession(sid: string): Promise<void> {
  await safeCommand((redis) =>
    redis.set(`${REVOKE_PREFIX}${sid}`, "1", "EX", SESSION_MAX_TTL_MS / 1000),
  );
}

/** True when a session id was revoked. Fails open when Redis is unavailable. */
export async function isSessionRevoked(sid: string): Promise<boolean> {
  const hit = await safeCommand((redis) =>
    redis.exists(`${REVOKE_PREFIX}${sid}`),
  );
  return hit === 1;
}

/** Set-Cookie attributes for the session cookie. */
export function sessionCookieAttributes(
  payload: SessionPayload,
): CookieAttributes {
  return {
    expires: new Date(payload.exp),
    httpOnly: true,
    maxAge: Math.max(0, Math.floor((payload.exp - Date.now()) / 1000)),
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  };
}

export interface CookieAttributes {
  expires: Date;
  httpOnly: boolean;
  maxAge: number;
  path: string;
  sameSite: "lax";
  secure: boolean;
}

/** Serialize a cookie value + attributes into a Set-Cookie header string. */
function serializeCookie(
  name: string,
  value: string,
  attrs: CookieAttributes,
): string {
  const parts = [
    `${name}=${value}`,
    `Expires=${attrs.expires.toUTCString()}`,
    `Max-Age=${attrs.maxAge}`,
    `Path=${attrs.path}`,
    `SameSite=${attrs.sameSite[0]?.toUpperCase()}${attrs.sameSite.slice(1)}`,
    attrs.httpOnly ? "HttpOnly" : "",
    attrs.secure ? "Secure" : "",
  ].filter(Boolean);
  return parts.join("; ");
}

/** Set-Cookie header used to delete the session cookie on logout. */
export function clearSessionCookie(name = SESSION_COOKIE): string {
  const past = new Date(0);
  return serializeCookie(name, "", {
    expires: past,
    httpOnly: true,
    maxAge: 0,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
}
