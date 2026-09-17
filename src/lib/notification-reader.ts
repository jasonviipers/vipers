import { createHash } from "node:crypto";

import { extractApiKey } from "@/lib/api-key";
import { sessionFromRequest } from "@/lib/session-auth";

/**
 * Notification reader identity.
 *
 * Read state is keyed by the caller's identity — the signed session subject
 * when a browser session cookie is present, otherwise a hash of the valid API
 * key — so it syncs across every device using the same identity. The raw key
 * (or cookie token) is never stored.
 */

function readerIdFromKey(key: string): string {
  const digest = createHash("sha256").update(key).digest("hex");
  return `reader:${digest.slice(0, 24)}`;
}

/**
 * Resolve the reader identity for a request: the signed session subject when
 * present, otherwise a hash of the valid API key. Returns null when neither
 * a session nor an API key authenticates the caller.
 */
export function requestReaderId(request: Request): string | null {
  const session = sessionFromRequest(request);
  if (session) {
    return `reader:${session.subject}`;
  }
  const key = extractApiKey(request);
  return key ? readerIdFromKey(key) : null;
}
