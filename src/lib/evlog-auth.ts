import { createHash } from "node:crypto";
import { useLogger } from "@/lib/evlog";
import { classifyApiKey } from "@/lib/identity";
import { sessionFromRequest } from "@/lib/session-auth";

function extractApiKey(request: Request): string | null {
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

function apiKeySubject(key: string): string {
  const digest = createHash("sha256").update(key).digest("hex");
  return `api-key:${digest.slice(0, 16)}`;
}

/**
 * Attach the authenticated identity to the current wide event.
 *
 * Prefers the signed session cookie (the browser path); falls back to the
 * API key carried on the request (`x-api-key` / `Authorization: Bearer`).
 * Never logs the raw key — the cookie subject or a stable per-key hash is
 * used. Returns `true` when an identity was identified, `false` otherwise.
 */
export async function identifyEvlogUser(request: Request): Promise<boolean> {
  // biome-ignore lint/correctness/useHookAtTopLevel: evlog's useLogger is a request logger, not a React hook.
  const logger = useLogger();

  const session = sessionFromRequest(request);
  if (session) {
    logger.set({
      userId: session.subject,
      user: {
        id: session.subject,
        kind: session.kind,
        demo: session.demo,
      },
      auth: {
        method: "session",
        identified: true,
        kind: session.kind,
      },
    });
    return true;
  }

  const key = extractApiKey(request);
  if (!key) {
    logger.set({
      auth: { method: "api_key", identified: false, reason: "missing" },
    });
    return false;
  }

  const classification = classifyApiKey(key);
  const identified = classification !== "invalid";

  const data: Record<string, unknown> = {
    auth: { method: "api_key", identified },
  };

  if (identified) {
    const userId = apiKeySubject(key);
    data.userId = userId;
    data.user = {
      id: userId,
      kind: "api_key",
      demo: classification === "demo",
    };
  }

  logger.set(data);
  return identified;
}
