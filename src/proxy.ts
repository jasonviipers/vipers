import { evlogMiddleware } from "evlog/next";
import { type NextRequest, NextResponse } from "next/server";
import { extractApiKey } from "@/lib/api-key";
import { resolveApiKey } from "@/lib/identity";
import {
  clearSessionCookie,
  encodeSession,
  isSessionRevoked,
  refreshSession,
  SESSION_COOKIE,
  sessionCookieAttributes,
  verifySessionToken,
} from "@/lib/session";

const evlog = evlogMiddleware();

/**
 * Routes reachable WITHOUT a session cookie or API key. After login these
 * still work, adding a fresh cookie to the response on the way through.
 */
const PUBLIC_PATHS = new Set([
  "/api/auth/validate",
  "/api/auth/session",
  "/api/auth/logout",
]);

function isPublic(request: NextRequest): boolean {
  return PUBLIC_PATHS.has(request.nextUrl.pathname);
}

/**
 * Proxy (Next.js 16 middleware): the optimistic auth gate for /api.
 *
 * Requests must present EITHER a valid signed session cookie (the browser —
 * short-lived, refeshed on a sliding window so it dies ~15 min after the
 * last request) OR a valid API key (agents / headless automation). Neither
 * is stored long-term on the client in a JS-readable form: the cookie is
 * HttpOnly and the API key is only ever kept server-side.
 *
 * This is the FIRST line of defense. Each route handler re-verifies identity
 * and applies its own permission check (src/lib/session-auth.ts), so the
 * authenticated-but-unauthorized case (e.g. the read-only demo identity
 * calling a mutating endpoint) is rejected there, not here.
 */
export async function proxy(request: NextRequest) {
  // Logged-in browser session takes priority.
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = verifySessionToken(token);

  if (session) {
    const revoked = await isSessionRevoked(session.sid);
    if (revoked) {
      return unauthorized(clearSessionCookie());
    }

    // Valid session → refresh the sliding window and forward.
    const fresh = refreshSession(session);
    const response = await evlog(request);
    response.cookies.set(
      SESSION_COOKIE,
      encodeSession(fresh),
      sessionCookieAttributes(fresh),
    );
    return response;
  }

  // API-key fallback: agents / headless heads of the same fleet.
  const key = extractApiKey(request);
  const identity = key ? resolveApiKey(key) : null;

  if (!identity) {
    if (isPublic(request)) {
      return evlog(request);
    }
    return unauthorized();
  }

  // We had a key — forward it (minus a request-scoped identity header: route
  // handlers derive authorization from their own verification, never from a
  // header this proxy could have let through).
  return evlog(request);
}

function unauthorized(setCookieHeader?: string): NextResponse {
  const response = NextResponse.json(
    { error: "unauthorized: a signed session cookie or API key is required" },
    { status: 401 },
  );
  if (setCookieHeader) {
    response.cookies.set("viipers_session", "", {
      expires: new Date(0),
      httpOnly: true,
      path: "/",
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 0,
    });
  }
  return response;
}

export const config = {
  matcher: ["/api/:path*"],
};
