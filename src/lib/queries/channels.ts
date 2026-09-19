import {
  queryOptions,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";

/**
 * Channel integration payload shape served by GET /api/channels. `logo` is
 * the Composio-provided icon URL — the UI never ships its own channel icons.
 */
export interface ChannelStatus {
  connected: boolean;
  connectionId: string | null;
  connectionStatus: string | null;
  isNoAuth: boolean;
  logo: string | null;
  name: string;
  note: string | null;
  slug: string;
}

export interface ChannelsStatusResponse {
  channels: ChannelStatus[];
  configured: boolean;
  /** Composio failure detail when configured but unreachable (e.g. 401). */
  error?: string;
}

interface ConnectLinkResponse {
  connectionRequestId: string;
  redirectUrl: string;
}

interface DisconnectOutcome {
  outcome: "deleted" | "no-connection" | "not-found" | "unconfigured";
}

export const channelsKeys = {
  all: ["channels"] as const,
  status: () => [...channelsKeys.all, "status"] as const,
};

async function fetchJson<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`API ${response.status}: ${detail || response.statusText}`);
  }
  return (await response.json()) as T;
}

export const channelsQueries = {
  status: (enabled = true) =>
    queryOptions({
      enabled,
      queryKey: channelsKeys.status(),
      queryFn: () => fetchJson<ChannelsStatusResponse>("/api/channels"),
      // Connection state changes when the operator completes OAuth in the
      // popup; a modest poll keeps CONNECTED badges honest without spamming
      // Composio (each read creates a short-lived server-side session view).
      refetchInterval: 20_000,
      staleTime: 20_000,
    }),
};

/**
 * Popup window references per channel. The Composio callback page closes
 * its own window (script-opened popups are closable by the opened page), so
 * the opener keeps the reference only to nudge focus back when the operator
 * lands on /channels with ?connected=<slug> while the popup is somehow
 * still open. Keyed by channel so two parallel connect flows don't clash.
 */
const popupRefs = new Map<string, Window | null>();

/** Close the connect popup for a channel, if it's still open. */
export function closeChannelPopup(channel: string): void {
  const popup = popupRefs.get(channel);
  if (popup && !popup.closed) {
    popup.close();
  }
  popupRefs.delete(channel);
}

/**
 * Remove the operator's connection for a channel (DELETE
 * /api/channels/connect?channel=<slug>) and refresh status immediately.
 */
export function useDisconnectChannel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (channel: string): Promise<DisconnectOutcome> => {
      const response = await fetch(
        `/api/channels/connect?channel=${encodeURIComponent(channel)}`,
        { method: "DELETE" },
      );
      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new Error(detail || `API ${response.status}`);
      }
      return (await response.json()) as DisconnectOutcome;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: channelsKeys.status() });
    },
  });
}

/**
 * Start the connect flow for a channel: POSTs to /api/channels/connect and
 * opens the returned Composio Connect Link in a popup, pointed back at this
 * page via callbackUrl. On completion the provider redirects to
 * /channels?connected=<slug>; that arrival refocuses/closes the popup and
 * invalidates the status query, flipping the badge to CONNECTED.
 */
export function useConnectChannel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      callbackUrl?: string;
      channel: string;
    }): Promise<ConnectLinkResponse> => {
      const response = await fetch("/api/channels/connect", {
        body: JSON.stringify(input),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new Error(detail || `API ${response.status}`);
      }
      return (await response.json()) as ConnectLinkResponse;
    },
    onMutate: ({ channel, callbackUrl }) => {
      // The popup must open synchronously with the click (popup blockers
      // gate async-opened windows), so it's opened in onMutate with a
      // placeholder and routed to the real Composio URL in onSuccess.
      const popup = window.open("about:blank", `connect-${channel}`);
      if (popup) {
        popupRefs.set(channel, popup);
      } else if (callbackUrl) {
        // Popup blocked: fall back to same-tab navigation. The redirect-back
        // flow lands the operator here either way.
        popupRefs.set(channel, null);
      }
      return { callbackUrl };
    },
    onSuccess: (data, { channel }, context) => {
      const popup = popupRefs.get(channel);
      if (popup && !popup.closed) {
        popup.location.href = data.redirectUrl;
      } else {
        // Popup blocked → same-tab flow; only navigate when we have a
        // callback to come back to, otherwise a new tab is less disruptive.
        if (context?.callbackUrl) {
          window.location.href = data.redirectUrl;
          return;
        }
        window.open(data.redirectUrl, "_blank", "noopener,noreferrer");
      }
      // Re-check status right away (and the poller keeps checking) so
      // CONNECTED appears as soon as the operator finishes authorizing.
      void queryClient.invalidateQueries({ queryKey: channelsKeys.status() });
    },
    onError: (_error, { channel }) => {
      // A failed mint leaves a blank popup behind — close it so the
      // operator isn't staring at an empty tab.
      closeChannelPopup(channel);
    },
  });
}
