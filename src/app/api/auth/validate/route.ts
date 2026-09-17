import { NextResponse } from "next/server";
import { useLogger, withEvlog } from "@/lib/evlog";
import { identifyEvlogUser } from "@/lib/evlog-auth";
import { resolveApiKey } from "@/lib/identity";
import {
  mintSession,
  SESSION_COOKIE,
  sessionCookieAttributes,
  verifySessionToken,
} from "@/lib/session";

/**
 * POST /api/auth/validate — verify an API key and establish a SESSION.
 *
 * The raw key is checked once, here, server-side (constant-time against the
 * operator/demo keys). On success the response sets a short-lived, HttpOnly,
 * HMAC-signed session cookie (`viipers_session`) and the raw key is never
 * handed back to the browser or kept in JS-accessible storage. From then on
 * the middleware (src/proxy.ts) verifies and refreshes that cookie on every
 * request; nothing permanent lives in the browser.
 */
export const POST = withEvlog(async (request: Request) => {
  const logger = useLogger();
  logger.set({ integration: "auth" });

  await identifyEvlogUser(request);

  let key: unknown;
  try {
    const body = (await request.json()) as { key?: unknown };
    key = body?.key;
  } catch {
    return NextResponse.json(
      { ok: false, error: "bad_request" },
      { status: 400 },
    );
  }

  if (typeof key !== "string" || !key.trim()) {
    return NextResponse.json(
      { ok: false, error: "invalid_key" },
      { status: 401 },
    );
  }

  const identity = resolveApiKey(key);
  if (!identity) {
    logger.set({ audit: "api_key_rejected" });
    return NextResponse.json(
      { ok: false, error: "invalid_key" },
      { status: 401 },
    );
  }

  const token = mintSession({
    sub: identity.subject,
    kind: identity.kind,
    agentId: identity.agentId,
    demo: identity.demo,
  });
  const payload = verifySessionToken(token);

  const response = NextResponse.json({
    ok: true,
    demo: identity.demo,
    identity: {
      subject: identity.subject,
      kind: identity.kind,
      agentId: identity.agentId,
    },
  });
  if (payload) {
    response.cookies.set(
      SESSION_COOKIE,
      token,
      sessionCookieAttributes(payload),
    );
  }

  logger.set({
    demo: identity.demo,
    auth: { method: "api_key", kind: identity.kind },
    audit: "api_key_authenticated",
  });
  return response;
});
