"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Radio, X } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useTerminalAuthenticated } from "@/components/terminal/terminal-auth-context";
import {
  type ChannelStatus,
  channelsKeys,
  channelsQueries,
  closeChannelPopup,
  useConnectChannel,
  useDisconnectChannel,
} from "@/lib/queries/channels";

/**
 * CHANNELS — operator-facing integration page.
 *
 * Every channel icon is the `logo` URL returned by Composio's session
 * toolkits payload; the UI ships no icon assets of its own. When Composio
 * is unconfigured the page says so honestly instead of rendering a fake
 * setup state.
 *
 * Connect flow: CONNECT opens the Composio authorization page (popup, or
 * same-tab when popups are blocked). On completion the provider redirects
 * back to this page as /channels?connected=<slug>; the arrival closes the
 * popup, verifies the connection via the status query, and strips the query
 * param from the URL — the badge flip to CONNECTED is the confirmation.
 * The param carries only the channel slug, never tokens.
 */

const CONNECTED_PARAM = "connected";

function statusBadge(
  channel: ChannelStatus,
  verifying = false,
): { label: string; className: string } {
  if (verifying) {
    return { className: "text-terminal-cyan", label: "VERIFYING…" };
  }
  if (channel.connected) {
    return { className: "text-terminal-green", label: "CONNECTED" };
  }
  if (
    channel.connectionStatus === "INITIALIZING" ||
    channel.connectionStatus === "INITIATED"
  ) {
    return { className: "text-terminal-amber", label: "AUTHORIZING" };
  }
  return { className: "text-muted-foreground", label: "NOT CONNECTED" };
}

function ChannelIcon({ channel }: { channel: ChannelStatus }) {
  if (channel.logo) {
    return (
      // biome-ignore lint/performance/noImgElement: icon URLs come from Composio per toolkit and vary by project; a plain img avoids next/image remote-pattern config for a host list we don't control
      <img
        alt=""
        aria-hidden="true"
        className="h-8 w-8 rounded-sm"
        src={channel.logo}
      />
    );
  }
  // Honest fallback when Composio gave us no logo (unconfigured/error):
  // a neutral glyph, never a hand-drawn brand mark.
  return (
    <div
      aria-hidden="true"
      className="flex h-8 w-8 items-center justify-center border border-border bg-secondary"
    >
      <Radio className="h-4 w-4 text-muted-foreground" />
    </div>
  );
}

function ChannelRow({
  channel,
  verifying,
}: {
  channel: ChannelStatus;
  verifying: boolean;
}) {
  const connect = useConnectChannel();
  const disconnect = useDisconnectChannel();
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);
  const badge = statusBadge(channel, verifying && !channel.connected);
  const connectError =
    connect.error instanceof Error ? connect.error.message : null;
  const disconnectError =
    disconnect.error instanceof Error ? disconnect.error.message : null;

  return (
    <div className="flex items-center gap-3 border-b border-border/50 px-4 py-3 transition-colors hover:bg-secondary/30">
      <ChannelIcon channel={channel} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-bold tracking-wide text-foreground uppercase">
            {channel.name}
          </span>
          <span className={`text-[10px] font-bold ${badge.className}`}>
            {badge.label}
          </span>
          {channel.slug === "reddit" && (
            <span className="text-[10px] text-terminal-cyan">
              POWERS SENTIMENT FEED
            </span>
          )}
        </div>
        {channel.note && (
          <p className="mt-0.5 text-[10px] leading-relaxed text-muted-foreground">
            {channel.note}
          </p>
        )}
      </div>
      {connectError && (
        <span
          className="max-w-[16rem] shrink-0 break-all border border-terminal-red/30 bg-terminal-red/10 px-2 py-1 text-[10px] text-terminal-red"
          role="alert"
        >
          {connectError.includes("Invalid API key")
            ? "Composio rejected COMPOSIO_API_KEY — set a valid Platform project key (ak_…) in .env"
            : connectError}
        </span>
      )}
      {disconnectError && (
        <span
          className="max-w-[16rem] shrink-0 break-all border border-terminal-red/30 bg-terminal-red/10 px-2 py-1 text-[10px] text-terminal-red"
          role="alert"
        >
          {disconnectError}
        </span>
      )}
      {channel.connected ? (
        confirmingDisconnect ? (
          <span className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => {
                disconnect.mutate(channel.slug);
                setConfirmingDisconnect(false);
              }}
              disabled={disconnect.isPending}
              className="border border-terminal-red/40 bg-terminal-red/10 px-2 py-1 text-[10px] font-bold tracking-wider text-terminal-red transition-colors hover:bg-terminal-red/20 disabled:opacity-50"
            >
              {disconnect.isPending ? "REMOVING…" : "CONFIRM"}
            </button>
            <button
              type="button"
              onClick={() => setConfirmingDisconnect(false)}
              className="border border-border bg-secondary px-2 py-1 text-[10px] font-bold tracking-wider text-muted-foreground transition-colors hover:text-foreground"
            >
              CANCEL
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmingDisconnect(true)}
            className="flex shrink-0 items-center gap-1.5 border border-border bg-secondary px-2 py-1 text-[10px] font-bold tracking-wider text-muted-foreground transition-colors hover:border-terminal-red/40 hover:text-terminal-red"
            title="Remove this connection (reversible — reconnect any time)"
          >
            <X className="h-3 w-3" />
            DISCONNECT
          </button>
        )
      ) : (
        <button
          type="button"
          onClick={() =>
            connect.mutate({
              callbackUrl: `${window.location.origin}/channels?connected=${channel.slug}`,
              channel: channel.slug,
            })
          }
          disabled={connect.isPending}
          className="flex shrink-0 items-center gap-1.5 border border-border bg-secondary px-2 py-1 text-[10px] font-bold tracking-wider text-foreground transition-colors hover:border-terminal-green/40 hover:text-terminal-green disabled:opacity-50"
        >
          {connect.isPending ? (
            "OPENING…"
          ) : (
            <>
              <ExternalLink className="h-3 w-3" />
              CONNECT
            </>
          )}
        </button>
      )}
    </div>
  );
}

export function ChannelsView() {
  const authed = useTerminalAuthenticated();
  const searchParams = useSearchParams();
  const { data, isError, isPending } = useQuery(channelsQueries.status(authed));

  const channels = data?.channels ?? [];

  // -- Redirect-back arrival (/?connected=<slug>) --------------------------
  // The Composio callback lands on this page after the provider flow — in
  // whichever window followed it. Popup flow: that's the popup itself, so it
  // notifies the opener (postMessage), closes itself, and focus returns to
  // the terminal. Same-tab flow (popup was blocked): the arrival IS the main
  // tab, so it verifies inline. Either way the ?connected param carries only
  // the channel slug, never tokens.
  const queryClient = useQueryClient();
  const [verifyingSlug, setVerifyingSlug] = useState<string | null>(null);
  const arrivalHandled = useRef(false);

  useEffect(() => {
    const slug = searchParams.get(CONNECTED_PARAM);
    if (!slug || arrivalHandled.current) {
      return;
    }
    arrivalHandled.current = true;

    if (window.opener && !window.opener.closed) {
      // Popup flow: tell the terminal tab, then close this popup.
      try {
        window.opener.postMessage(
          { channel: slug, type: "channel-connected" },
          window.location.origin,
        );
      } catch {
        // Opener gone or cross-origin — fall through to self-close.
      }
      window.close();
      return;
    }

    // Same-tab flow: verify inline. Strip the param so a refresh doesn't
    // re-trigger the arrival effect.
    closeChannelPopup(slug);
    setVerifyingSlug(slug);
    const url = new URL(window.location.href);
    url.searchParams.delete(CONNECTED_PARAM);
    window.history.replaceState(null, "", url.pathname + url.search);
  }, [searchParams]);

  // Popup flow, opener side: receive the arrival notice, flip the badge.
  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (
        event.origin !== window.location.origin ||
        typeof event.data !== "object" ||
        event.data === null ||
        (event.data as { type?: unknown }).type !== "channel-connected"
      ) {
        return;
      }
      const channel = (event.data as { channel?: unknown }).channel;
      if (typeof channel === "string") {
        setVerifyingSlug(channel);
        closeChannelPopup(channel);
      }
      void queryClient.invalidateQueries({
        queryKey: channelsKeys.status(),
      });
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [queryClient]);

  // The status poller (20s) + the invalidate-on-connect confirm the state;
  // the VERIFYING badge clears as soon as the connection shows active or a
  // bounded wait elapses (honest failure instead of an endless spinner).
  useEffect(() => {
    if (!verifyingSlug) {
      return;
    }
    const timer = setTimeout(() => setVerifyingSlug(null), 30_000);
    return () => clearTimeout(timer);
  }, [verifyingSlug]);

  const verifyingChannel = data?.channels.find((c) => c.slug === verifyingSlug);
  useEffect(() => {
    if (verifyingSlug && verifyingChannel?.connected) {
      setVerifyingSlug(null);
    }
  }, [verifyingSlug, verifyingChannel?.connected]);

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-card px-3 py-2 sm:px-4">
        <div className="flex items-center gap-3">
          <h1 className="text-xs font-bold tracking-wider text-foreground">
            CHANNEL INTEGRATIONS
          </h1>
          <span className="text-[10px] text-muted-foreground">
            {isPending
              ? "loading..."
              : isError
                ? "offline — retrying"
                : `${channels.filter((c) => c.connected).length}/${channels.length} enabled`}
          </span>
        </div>
        <span className="text-[10px] text-muted-foreground">
          AUTH VIA{" "}
          <span className="font-bold text-terminal-green">COMPOSIO</span>
        </span>
      </div>

      {isPending ? (
        <div className="flex flex-col">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-14 animate-pulse border-b border-border/50 bg-secondary"
            />
          ))}
        </div>
      ) : isError ? (
        <div className="p-4 text-xs text-terminal-red">
          CHANNEL STATUS UNAVAILABLE — retrying
        </div>
      ) : !data?.configured ? (
        <div className="p-4 text-xs leading-relaxed text-muted-foreground">
          <p className="font-bold text-terminal-amber">
            COMPOSIO NOT CONFIGURED
          </p>
          <p className="mt-2 max-w-2xl">
            Set <code className="text-terminal-green">COMPOSIO_API_KEY</code> in
            the environment (Platform project key from dashboard.composio.dev)
            and restart the terminal. Until then the fleet runs on its
            non-social sources and the Reddit sentiment feed stays empty —
            nothing is invented to fill the gap.
          </p>
        </div>
      ) : (
        <div className="flex flex-col">
          {data.error && (
            <div className="border-b border-terminal-red/30 bg-terminal-red/10 px-4 py-3 text-xs leading-relaxed text-terminal-red">
              <p className="font-bold">COMPOSIO ERROR — channels unavailable</p>
              <p className="mt-1 break-all text-[10px] text-muted-foreground">
                {data.error}
              </p>
              <p className="mt-1 text-[10px] text-muted-foreground">
                If this says “Invalid API key”, COMPOSIO_API_KEY is not a valid
                Platform project key (dashboard.composio.dev → Platform →
                project → Getting Started; keys look like ak_…). For You
                consumer keys (ck_…) are not interchangeable.
              </p>
            </div>
          )}
          {channels.map((channel) => (
            <ChannelRow
              key={channel.slug}
              channel={channel}
              verifying={verifyingSlug === channel.slug}
            />
          ))}
          <p className="px-4 py-3 text-[10px] leading-relaxed text-muted-foreground">
            CONNECT opens a Composio-hosted authorization page. On success you
            are redirected back here and the channel flips to CONNECTED —
            connections persist and every agent in the fleet shares them.
          </p>
        </div>
      )}
    </div>
  );
}
