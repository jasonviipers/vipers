import {
  CHANNEL_SLUGS,
  type ChannelSlug,
  createChannelConnectLink,
  type DisconnectResult,
  disconnectChannel,
} from "@/lib/composio";
import { getLogger, withEvlog } from "@/lib/evlog";
import { requireWriteAccess } from "@/lib/session-auth";

export const dynamic = "force-dynamic";

const CONNECTABLE: ReadonlySet<string> = new Set<string>(CHANNEL_SLUGS);

const OUTCOME_STATUS: Record<DisconnectResult["outcome"], number> = {
  deleted: 200,
  "no-connection": 409,
  "not-found": 404,
  unconfigured: 503,
};

/**
 * POST /api/channels/connect — start the operator's authorization for a
 * channel. Body: { "channel": "reddit" | "twitter" | "discord" | "telegram",
 * "callbackUrl"?: string }.
 *
 * Composio owns the provider OAuth flow; this route only mints the Connect
 * Link (never a provider OAuth handshake) and returns it for the browser to
 * open. `callbackUrl` is forwarded to Composio so the provider's completion
 * screen redirects the operator back to the terminal (/channels) — the URL
 * is validated as same-origin and carries no secrets. Write-guarded: the
 * demo session and read-only agents are rejected by requireWriteAccess —
 * connecting channels mutates operator state.
 */
export const POST = withEvlog(async (request: Request) => {
  const logger = getLogger();
  logger.set({ integration: "channels" });

  const auth = requireWriteAccess(request);
  if (!auth.ok) {
    return auth.response;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const channel =
    typeof body === "object" && body !== null && "channel" in body
      ? (body as { channel: unknown }).channel
      : undefined;

  if (typeof channel !== "string" || !CONNECTABLE.has(channel)) {
    return Response.json(
      {
        error: `channel must be one of: ${CHANNEL_SLUGS.join(", ")}`,
      },
      { status: 400 },
    );
  }

  // Same-origin callback only: the operator's browser lands back on this
  // deployment after the provider flow. Ignore anything pointing elsewhere.
  const rawCallback =
    typeof body === "object" && body !== null && "callbackUrl" in body
      ? (body as { callbackUrl: unknown }).callbackUrl
      : undefined;
  let callbackUrl: string | undefined;
  if (typeof rawCallback === "string" && rawCallback.length > 0) {
    try {
      const callbackOrigin = new URL(rawCallback).origin;
      const requestOrigin = new URL(request.url).origin;
      if (callbackOrigin === requestOrigin) {
        callbackUrl = rawCallback;
      }
    } catch {
      // Unparseable → treat as absent; the flow still works, just without
      // the redirect-back convenience.
    }
  }

  try {
    const link = await createChannelConnectLink(
      channel as ChannelSlug,
      callbackUrl,
    );
    if (!link || !link.redirectUrl) {
      return Response.json(
        { error: "Composio is not configured (COMPOSIO_API_KEY missing)" },
        { status: 503 },
      );
    }
    logger.set({ channel });
    return Response.json(link);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    // A Composio 401 (invalid project key) is a configuration error, not a
    // transient upstream failure — say so explicitly.
    if (message.includes("Invalid API key") || message.includes("401")) {
      return Response.json(
        {
          error:
            "Composio rejected the configured key (401 Invalid API key). Set a valid Platform project key (ak_…) from dashboard.composio.dev → Platform → Getting Started.",
        },
        { status: 503 },
      );
    }
    return Response.json(
      { error: `failed to create connect link: ${message}` },
      { status: 502 },
    );
  }
});

/**
 * DELETE /api/channels/connect?channel=<slug> — remove the operator's
 * connected account for a channel (Composio `connectedAccounts.delete`).
 *
 * Reversible: the operator reconnects any time via /channels → CONNECT.
 * Write-guarded like the connect route — the demo session and read-only
 * agents are rejected by requireWriteAccess.
 */
export const DELETE = withEvlog(async (request: Request) => {
  const logger = getLogger();
  logger.set({ integration: "channels" });

  const auth = requireWriteAccess(request);
  if (!auth.ok) {
    return auth.response;
  }

  const channel = new URL(request.url).searchParams.get("channel");
  if (!channel || !CONNECTABLE.has(channel)) {
    return Response.json(
      { error: `channel must be one of: ${CHANNEL_SLUGS.join(", ")}` },
      { status: 400 },
    );
  }

  try {
    const result = await disconnectChannel(channel as ChannelSlug);
    logger.set({ channel, outcome: result.outcome });
    const status = OUTCOME_STATUS[result.outcome];
    return Response.json(result, { status });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    if (message.includes("Invalid API key") || message.includes("401")) {
      return Response.json(
        {
          error:
            "Composio rejected the configured key (401 Invalid API key). Set a valid Platform project key (ak_…) from dashboard.composio.dev → Platform → Getting Started.",
        },
        { status: 503 },
      );
    }
    return Response.json(
      { error: `failed to disconnect channel: ${message}` },
      { status: 502 },
    );
  }
});
