import { env } from "@/env";

export const API_KEY_PREFIX = env.NEXT_PUBLIC_API_KEY_PREFIX;

export const DEMO_API_KEY = "vps_demo_readonly_9f2k1m0q7x4w";

/**
 * Extract an API key from a request's `x-api-key` header or
 * `Authorization: Bearer` header. Returns the trimmed key, or null when
 * neither header carries one.
 */
export function extractApiKey(request: Request): string | null {
  const header = request.headers.get("x-api-key");
  if (header?.trim()) {
    return header.trim();
  }

  const authorization = request.headers.get("authorization");
  if (!authorization) {
    return null;
  }

  const [scheme, credentials, ...rest] = authorization.trim().split(" ");
  if (scheme?.toLowerCase() !== "bearer") {
    return null;
  }

  const key = [credentials, ...rest].filter(Boolean).join(" ");
  return key.length > 0 ? key : null;
}

/**
 * Client-side session marker.
 *
 * The real credential NEVER lives in the browser. After `/api/auth/validate`
 * succeeds the server sets an HttpOnly signed cookie (`viipers_session`) that
 * JavaScript cannot read; the client only records whether that session is the
 * read-only demo (so the UI can disable credential controls up front). No
 * API key or permanent secret is stored anywhere in JS-accessible storage.
 */
const STORAGE_KEY = "viipers_client_session";

export interface ClientSession {
  /** True when the active session authenticated with the demo key. */
  demo: boolean;
}

export function getClientSession(): ClientSession | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { demo?: unknown };
    if (typeof parsed?.demo !== "boolean") return null;
    return { demo: parsed.demo };
  } catch {
    return null;
  }
}

export function saveClientSession(session: ClientSession): void {
  if (typeof window === "undefined") {
    return;
  }
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

export function clearClientSession(): void {
  if (typeof window === "undefined") {
    return;
  }
  sessionStorage.removeItem(STORAGE_KEY);
}

/**
 * True when the current session authenticated with the shared demo key.
 * Demo sessions are READ-ONLY server-side (permissions.ts → 403 on writes);
 * the UI uses this to disable credential-management controls up front
 * instead of letting writes fail with an opaque error.
 */
export function isDemoSession(): boolean {
  return getClientSession()?.demo === true;
}
