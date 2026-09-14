import { createHash } from "node:crypto";

/**
 * Notification reader identity.
 *
 * Read state is keyed by a hash of the caller's API key so it syncs across
 * every device using the same key — the raw key is never stored. Kept in
 * its own module (instead of evlog-auth) so route handlers can import the
 * identity helpers without pulling in request-logger machinery.
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

export function readerIdFromKey(key: string): string {
  const digest = createHash("sha256").update(key).digest("hex");
  return `reader:${digest.slice(0, 24)}`;
}
