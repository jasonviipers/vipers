/**
 * Request-level authentication for route handlers.
 *
 * Authentication ("who is calling") is verified HERE, in the route layer —
 * never trusted from a header the proxy injects. Order of preference:
 *
 *  1. A valid signed session cookie (`viipers_session`) — the browser path.
 *  2. A valid API key (`x-api-key` / `Authorization: Bearer`) — agent /
 *     headless automation. The raw key is classified constant-time and never
 *     stored; it resolves to an operator, demo, or per-agent identity.
 *
 * Authorization ("what may they do") is a SEPARATE decision baked into each
 * guard (requireWriteAccess, requirePermission) via the identity's
 * permission set (src/lib/permissions.ts). Authentication and authorization
 * are intentionally distinct concepts here.
 *
 * The proxy (src/proxy.ts) is an optimistic gate: it rejects requests with
 * no valid credentials, refreshes the sliding cookie, and checks Redis
 * revocation. These guards re-verify the cookie/key independently so a route
 * is protected even if the proxy were bypassed or misconfigured.
 */

import { extractApiKey } from "@/lib/api-key";
import { agentIdentities, type Identity, resolveApiKey } from "@/lib/identity";
import {
  can,
  DEMO_PERMISSIONS,
  OPERATOR_PERMISSIONS,
  type Permission,
} from "@/lib/permissions";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/session";

export type AuthResult =
  | { ok: true; identity: Identity }
  | { ok: false; response: Response };

/** Parse the value of a named cookie from a raw Cookie header. */
export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    if (key === name) {
      const value = part.slice(eq + 1).trim();
      return value.length > 0 ? value : null;
    }
  }
  return null;
}

function identityFromPayload(
  payload: NonNullable<ReturnType<typeof verifySessionToken>>,
): Identity | null {
  if (payload.kind === "agent" && payload.sub.startsWith("agent:")) {
    const agentId = payload.sub.slice("agent:".length);
    const identity = agentIdentities.get(agentId);
    if (identity) {
      return { ...identity, demo: payload.demo };
    }
    return null;
  }
  if (payload.kind === "operator" && payload.sub === "operator") {
    return {
      subject: "operator",
      kind: "operator",
      demo: payload.demo,
      permissions: OPERATOR_PERMISSIONS,
    };
  }
  if (payload.kind === "demo" && payload.sub === "demo") {
    return {
      subject: "demo",
      kind: "demo",
      demo: true,
      permissions: DEMO_PERMISSIONS,
    };
  }
  return null;
}

/** Return the session identity when the request carries a valid cookie. */
export function sessionFromRequest(request: Request): Identity | null {
  const token = readCookie(request, SESSION_COOKIE);
  const payload = verifySessionToken(token);
  if (!payload) return null;
  return identityFromPayload(payload);
}

function authenticate(request: Request): AuthResult {
  const fromSession = sessionFromRequest(request);
  if (fromSession) {
    return { ok: true, identity: fromSession };
  }

  const key = extractApiKey(request);
  if (key) {
    const identity = resolveApiKey(key);
    if (identity) {
      return { ok: true, identity };
    }
  }

  return {
    ok: false,
    response: Response.json(
      { error: "unauthorized: missing or invalid session" },
      { status: 401 },
    ),
  };
}

/** True when an identity holds any capability that writes system state. */
function hasWriteCapability(identity: Identity): boolean {
  const writePermissions = [
    "run:agent",
    "jobs:run",
    "credentials:manage",
    "risk:control",
    "settings:manage",
    "strategies:manage",
    "execution:submit",
    "consensus:decide",
  ] as const;
  return writePermissions.some((permission) =>
    can(identity.permissions, permission),
  );
}

/**
 * Guard for mutating endpoints (POST/PATCH/DELETE, jobs, agent runs).
 * Missing/invalid credentials → 401; identities that authenticate but hold
 * no write capability (the demo key, or read-only agents) → 403.
 */
export function requireWriteAccess(request: Request): AuthResult {
  const auth = authenticate(request);
  if (!auth.ok) return auth;
  if (!hasWriteCapability(auth.identity)) {
    return {
      ok: false,
      response: Response.json(
        { error: "forbidden: identity is read-only" },
        { status: 403 },
      ),
    };
  }
  return auth;
}

/**
 * Granular guard: the identity must authenticate AND hold the given
 * permission. This is the authorization primitive — "prove who you are,
 * then prove you are allowed to do THIS". Agents, demo sessions and the
 * operator can therefore be treated with different rights on one endpoint.
 */
export function requirePermission(
  request: Request,
  permission: Permission,
): AuthResult {
  const auth = authenticate(request);
  if (!auth.ok) return auth;
  if (auth.identity.demo) {
    return {
      ok: false,
      response: Response.json(
        { error: "forbidden: the demo session is read-only" },
        { status: 403 },
      ),
    };
  }
  if (!can(auth.identity.permissions, permission)) {
    return {
      ok: false,
      response: Response.json(
        { error: `forbidden: missing '${permission}' permission` },
        { status: 403 },
      ),
    };
  }
  return auth;
}
