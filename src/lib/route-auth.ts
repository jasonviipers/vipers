import { classifyApiKey } from "@/lib/auth";
import { extractApiKey } from "@/lib/notification-reader";

/**
 * Shared API-key authorization for route handlers.
 *
 * The terminal authenticates with an API key (`x-api-key` / Bearer). Two
 * classifications matter:
 *
 * - `valid`  — a real operator key; full access.
 * - `demo`   — the demo key (named "demo_readonly"); READ-ONLY by design.
 *              It may call GET endpoints and personalization routes
 *              (notification read-state), but never mutating endpoints.
 *
 * Read endpoints stay public: this is a single-operator terminal and the
 * reads expose only derived, non-sensitive data. Every endpoint that can
 * mutate state, spend money (LLM calls), or trigger jobs must go through
 * `requireWriteAccess`.
 */

export type AuthSuccess = { ok: true; key: string; demo: boolean };
export type AuthFailure = { ok: false; response: Response };
export type AuthResult = AuthSuccess | AuthFailure;

/** Extract + classify the caller's key. 401 on missing/invalid keys. */
export function authenticate(request: Request): AuthResult {
  const key = extractApiKey(request);
  if (!key) {
    return {
      ok: false,
      response: Response.json(
        { error: "unauthorized: missing API key" },
        { status: 401 },
      ),
    };
  }

  const classification = classifyApiKey(key);
  if (classification === "invalid") {
    return {
      ok: false,
      response: Response.json(
        { error: "unauthorized: invalid API key" },
        { status: 401 },
      ),
    };
  }

  return { ok: true, key, demo: classification === "demo" };
}

/**
 * Guard for mutating endpoints (POST/PATCH/DELETE, jobs, agent runs).
 * Rejects missing/invalid keys with 401 and the demo key with 403 —
 * it is explicitly read-only and must not trigger LLM runs, job rollups,
 * or strategy changes.
 */
export function requireWriteAccess(request: Request): AuthResult {
  const auth = authenticate(request);
  if (!auth.ok) {
    return auth;
  }
  if (auth.demo) {
    return {
      ok: false,
      response: Response.json(
        { error: "forbidden: the demo key is read-only" },
        { status: 403 },
      ),
    };
  }
  return auth;
}
