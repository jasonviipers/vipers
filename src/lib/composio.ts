import { Composio } from "@composio/core";
import { env } from "@/env";

export const COMPOSIO_OPERATOR_USER_ID = "viipers-operator";

export const CHANNEL_SLUGS = [
  "reddit",
  "twitter",
  "discord",
  "telegram",
] as const;

export type ChannelSlug = (typeof CHANNEL_SLUGS)[number];

export interface ChannelStatus {
  slug: ChannelSlug;
  name: string;
  logo: string | null;
  isNoAuth: boolean;
  connected: boolean;
  connectionId: string | null;
  connectionStatus: string | null;
  note: string | null;
}

const CHANNEL_NOTES: Partial<Record<ChannelSlug, string>> = {
  twitter:
    "Twitter/X requires your own developer app credentials (Composio-managed OAuth was removed in Feb 2026). Configure an auth config with your X API keys in the Composio dashboard, then connect here.",
  telegram:
    "Telegram connects a bot token (from @BotFather) rather than a personal account login.",
};

let cachedComposio: Composio | null = null;

function composioClient(): Composio | null {
  const apiKey = env.COMPOSIO_API_KEY?.trim();
  if (!apiKey) {
    return null;
  }
  cachedComposio ??= new Composio({ apiKey });
  return cachedComposio;
}

export function isComposioConfigured(): boolean {
  return Boolean(env.COMPOSIO_API_KEY?.trim());
}

interface ToolkitState {
  slug: string;
  name: string;
  logo?: string;
  isNoAuth: boolean;
  connection?: {
    connectedAccount?: { id?: string; status?: string };
    isActive?: boolean;
  };
}

const STATUS_TTL_MS = 60_000;
let statusCache: {
  expires: number;
  value: { channels: ChannelStatus[]; configured: boolean; error?: string };
} | null = null;

export async function getChannelStatuses(): Promise<{
  channels: ChannelStatus[];
  configured: boolean;
  /** Composio failure detail when configured but unreachable (e.g. 401). */
  error?: string;
}> {
  if (statusCache && statusCache.expires > Date.now()) {
    return statusCache.value;
  }
  const value = await fetchChannelStatuses();
  // Only cache clean successes; failures stay uncached so the /channels page
  // recovers the moment Composio accepts us again.
  if (value.configured && !value.error) {
    statusCache = { expires: Date.now() + STATUS_TTL_MS, value };
  }
  return value;
}

async function fetchChannelStatuses(): Promise<{
  channels: ChannelStatus[];
  configured: boolean;
  error?: string;
}> {
  const client = composioClient();
  if (!client) {
    return {
      configured: false,
      channels: CHANNEL_SLUGS.map((slug) => ({
        slug,
        name: slug,
        logo: null,
        isNoAuth: false,
        connected: false,
        connectionId: null,
        connectionStatus: null,
        note: CHANNEL_NOTES[slug] ?? null,
      })),
    };
  }

  try {
    const session = await client.sessions.create(COMPOSIO_OPERATOR_USER_ID, {
      toolkits: [...CHANNEL_SLUGS],
    });
    const { items } = await session.toolkits();

    const bySlug = new Map(
      items.map((item) => [item.slug.toLowerCase(), item]),
    );
    return {
      configured: true,
      channels: CHANNEL_SLUGS.map((slug) => {
        const toolkit = bySlug.get(slug) as ToolkitState | undefined;
        const account = toolkit?.connection?.connectedAccount;
        return {
          slug,
          name: toolkit?.name ?? slug,
          logo: toolkit?.logo ?? null,
          isNoAuth: toolkit?.isNoAuth ?? false,
          connected: Boolean(toolkit?.connection?.isActive),
          connectionId: account?.id ?? null,
          connectionStatus: account?.status ?? null,
          note: CHANNEL_NOTES[slug] ?? null,
        };
      }),
    };
  } catch (error) {
    // Composio unreachable or rejecting us (bad key, outage, network):
    // surface the detail instead of silently degrading — an operator staring
    // at all-unconnected rows must be able to tell "not connected yet" from
    // "Composio rejected our key".
    return {
      configured: true,
      error: error instanceof Error ? error.message : String(error),
      channels: CHANNEL_SLUGS.map((slug) => ({
        slug,
        name: slug,
        logo: null,
        isNoAuth: false,
        connected: false,
        connectionId: null,
        connectionStatus: null,
        note: CHANNEL_NOTES[slug] ?? null,
      })),
    };
  }
}

export interface ConnectLinkResult {
  redirectUrl: string;
  connectionRequestId: string;
}

/**
 * Start the operator's authorization for a channel. Composio owns the
 * provider OAuth flow; we only ever surface its Connect Link. `callbackUrl`
 * is where Composio sends the operator's browser after the provider flow
 * completes — the /channels page reads `?connected=<slug>` from it and
 * verifies the resulting connection state (the URL carries no secrets).
 */
export async function createChannelConnectLink(
  slug: ChannelSlug,
  callbackUrl?: string,
): Promise<ConnectLinkResult | null> {
  const client = composioClient();
  if (!client) {
    return null;
  }
  const session = await client.sessions.create(COMPOSIO_OPERATOR_USER_ID, {
    toolkits: [...CHANNEL_SLUGS],
  });
  const request = await session.authorize(slug, {
    ...(callbackUrl ? { callbackUrl } : {}),
  });
  return {
    redirectUrl: request.redirectUrl ?? "",
    connectionRequestId: request.id,
  };
}

/** Latest connection state for one channel (used by the status poller). */
export async function getChannelConnection(slug: ChannelSlug): Promise<{
  connected: boolean;
  connectionId: string | null;
  status: string | null;
}> {
  const statuses = await getChannelStatuses();
  const channel = statuses.channels.find((c) => c.slug === slug);
  return {
    connected: channel?.connected ?? false,
    connectionId: channel?.connectionId ?? null,
    status: channel?.connectionStatus ?? null,
  };
}

export type DisconnectResult =
  | { outcome: "deleted" }
  | { outcome: "no-connection" }
  | { outcome: "not-found" }
  | { outcome: "unconfigured" };

/**
 * Remove the operator's connected account for a channel via
 * `connectedAccounts.delete`. Reversible — the operator can reconnect any
 * time through /channels → CONNECT. Busts the status cache so badges (and
 * the signals page's unconnected hint) flip immediately.
 */
export async function disconnectChannel(
  slug: ChannelSlug,
): Promise<DisconnectResult> {
  const client = composioClient();
  if (!client) {
    return { outcome: "unconfigured" };
  }
  const { connectionId } = await getChannelConnection(slug);
  if (!connectionId) {
    return { outcome: "no-connection" };
  }
  try {
    await client.connectedAccounts.delete(connectionId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      message.includes("404") ||
      message.toLowerCase().includes("not found")
    ) {
      // Status read was stale — the connection is already gone.
      return { outcome: "not-found" };
    }
    throw error;
  }
  statusCache = null;
  return { outcome: "deleted" };
}

export async function isRedditViaComposioActive(): Promise<boolean> {
  try {
    const statuses = await getChannelStatuses();
    return statuses.channels.some((c) => c.slug === "reddit" && c.connected);
  } catch {
    return false;
  }
}

// ── Reddit through the operator's connection ────────────────────────────────

export interface ComposioRedditPost {
  numComments: number;
  permalink: string | null;
  score: number;
  selftext: string;
  subreddit: string | null;
  title: string;
}

export async function fetchRedditPostsViaComposio(options: {
  limitPerSub?: number;
  query: string;
  subreddits: string[];
}): Promise<ComposioRedditPost[]> {
  const client = composioClient();
  if (!client) {
    return [];
  }

  const subredditFilter = options.subreddits
    .map((sub) => `subreddit:${sub}`)
    .join(" OR ");
  const searchQuery = `(${options.query}) (${subredditFilter})`;
  const limit = Math.min(Math.max(options.limitPerSub ?? 20, 1), 100);

  const session = await client.sessions.create(COMPOSIO_OPERATOR_USER_ID, {
    toolkits: ["reddit"],
  });

  const result = await session.execute("REDDIT_SEARCH_ACROSS_SUBREDDITS", {
    limit,
    result_type: ["link"],
    search_query: searchQuery,
    sort: "new",
    time_filter: "day",
  });

  if (result.error) {
    throw new Error(
      `Composio REDDIT_SEARCH_ACROSS_SUBREDDITS failed: ${result.error}`,
    );
  }

  // The tool's payload nests posts under data.children[i].data (a `posts`
  // array may also appear — see toolkit docs). Inspect both paths.
  const data = (result.data ?? {}) as {
    data?: { children?: { data?: Record<string, unknown> }[] };
    posts?: Record<string, unknown>[];
  };

  const children = data.data?.children ?? [];
  const rows: Record<string, unknown>[] = children
    .map((child) => child.data ?? {})
    .filter((row) => Object.keys(row).length > 0);

  if (rows.length === 0 && Array.isArray(data.posts)) {
    rows.push(...data.posts);
  }

  return rows
    .map((row) => ({
      numComments: Number(row.num_comments ?? 0),
      permalink:
        typeof row.permalink === "string" ? (row.permalink as string) : null,
      score: Number(row.score ?? 0),
      selftext:
        typeof row.selftext === "string" ? (row.selftext as string) : "",
      subreddit:
        typeof row.subreddit === "string" ? (row.subreddit as string) : null,
      title: typeof row.title === "string" ? (row.title as string) : "",
    }))
    .filter((post) => post.title.length > 0);
}
