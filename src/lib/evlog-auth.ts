import { createHash } from "node:crypto";

import { classifyApiKey } from "@/lib/auth";
import { useLogger } from "@/lib/evlog";

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
 * Attach the authenticated user to the current wide event from the API key
 * carried on the request (`x-api-key` or `Authorization: Bearer`).
 *
 * Never logs the raw key — stable per-key `userId` is derived from a hash.
 * Returns `true` when a valid or demo key was identified, `false` otherwise.
 */
export async function identifyEvlogUser(request: Request): Promise<boolean> {
  // biome-ignore lint/correctness/useHookAtTopLevel: evlog's useLogger is a request logger, not a React hook.
  const logger = useLogger();
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
