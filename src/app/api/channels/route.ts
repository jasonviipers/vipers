import { getChannelStatuses } from "@/lib/composio";
import { getLogger, withEvlog } from "@/lib/evlog";

export const dynamic = "force-dynamic";

/**
 * GET /api/channels — operator-facing channel integration status.
 *
 * Returns each channel's display name, Composio-provided logo, and live
 * connection state (from `session.toolkits()`), plus whether COMPOSIO_API_KEY
 * is configured at all. Read-only: any authenticated identity (operator,
 * demo, agents) may look; only the connect route mutates.
 */
export const GET = withEvlog(async () => {
  const logger = getLogger();
  logger.set({ integration: "channels" });

  const status = await getChannelStatuses();
  return Response.json(status);
});
