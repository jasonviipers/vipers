import { getLogger, withEvlog } from "@/lib/evlog";
import { SESSION_COOKIE } from "@/lib/session";
import { readCookie, sessionFromRequest } from "@/lib/session-auth";

/**
 * GET /api/auth/session — the caller's session identity.
 *
 * The client cannot read the HttpOnly session cookie, so it asks the server
 * "am I signed in, and as whom?". Returns the resolved identity so the UI can
 * gate on `authenticated` and `demo` without ever holding a secret.
 */
export const GET = withEvlog(async (request: Request) => {
  const logger = getLogger();
  logger.set({ integration: "auth" });

  const token = readCookie(request, SESSION_COOKIE);
  const identity = sessionFromRequest(request);
  const authenticated = Boolean(token && identity);

  logger.set({
    auth: { method: "session", identified: authenticated },
  });

  return Response.json({
    authenticated,
    demo: identity?.demo ?? false,
    identity: identity
      ? {
          subject: identity.subject,
          kind: identity.kind,
          agentId: identity.agentId,
          agent: identity.agent,
        }
      : null,
  });
});
