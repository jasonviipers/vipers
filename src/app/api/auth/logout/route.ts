import { useLogger, withEvlog } from "@/lib/evlog";
import {
  clearSessionCookie,
  revokeSession,
  SESSION_COOKIE,
  verifySessionToken,
} from "@/lib/session";
import { readCookie } from "@/lib/session-auth";

/**
 * POST /api/auth/logout — end the session.
 *
 * Revokes the session id (best-effort, Redis) so the signed cookie is
 * rejected even if copied, then clears the HttpOnly cookie from the browser.
 */
export const POST = withEvlog(async (request: Request) => {
  const logger = useLogger();
  logger.set({ integration: "auth" });

  const token = readCookie(request, SESSION_COOKIE);
  if (token) {
    const payload = verifySessionToken(token);
    if (payload?.sid) {
      await revokeSession(payload.sid);
    }
  }

  logger.set({ audit: "session_revoked" });

  const response = Response.json({ ok: true });
  response.headers.set("Set-Cookie", clearSessionCookie());
  return response;
});
