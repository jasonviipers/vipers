"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useTerminalAuthenticated } from "@/components/terminal/terminal-auth-context";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { type FeedEvent, feedQueries } from "@/lib/queries/events";

function getEventColor(type: FeedEvent["category"]) {
  switch (type) {
    case "trade":
      return "text-terminal-green";
    case "signal":
      return "text-terminal-amber";
    case "alert":
      return "text-terminal-red";
    case "consensus":
      return "text-terminal-gold";
    case "heartbeat":
      return "text-terminal-cyan";
  }
}

function getEventPrefix(type: FeedEvent["category"]) {
  switch (type) {
    case "trade":
      return "TRD";
    case "signal":
      return "SIG";
    case "alert":
      return "ALT";
    case "consensus":
      return "CON";
    case "heartbeat":
      return "HBT";
  }
}

function formatTimeAgo(date: Date, nowMs: number) {
  const seconds = Math.max(0, Math.floor((nowMs - date.getTime()) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h`;
}

const MAX_FEED_ROWS = 40;

export function LiveFeed() {
  const authed = useTerminalAuthenticated();
  const { data, isError, isPending } = useQuery(feedQueries.recent(authed));

  // Poll the clock so relative "time ago" labels stay fresh between fetches.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);

  const events = (data?.items ?? []).slice(0, MAX_FEED_ROWS);

  return (
    <section
      aria-label="Live event feed"
      className="flex flex-1 min-h-0 flex-col border border-border bg-card"
    >
      <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-2">
        <div className="flex items-center gap-2">
          <div
            className={`h-1.5 w-1.5 rounded-full ${
              isError
                ? "bg-terminal-red"
                : "bg-terminal-green animate-pulse-soft"
            }`}
            aria-hidden="true"
          />
          <Tooltip>
            <TooltipTrigger
              render={
                <h2 className="text-xs font-bold tracking-wider text-foreground cursor-help">
                  LIVE
                </h2>
              }
            />
            <TooltipContent
              side="bottom"
              sideOffset={6}
              className="bg-card text-muted-foreground border border-border text-xs max-w-64"
            >
              Real-time event log of trades, signals, alerts, and agent
              heartbeats across the system
            </TooltipContent>
          </Tooltip>
        </div>
        <span className="text-xs text-terminal-green">
          {isPending ? "..." : `${data?.onlineCount ?? 0} online`}
        </span>
      </div>
      <ScrollArea className="flex-1 min-h-0">
        {isPending ? (
          <div className="flex flex-col gap-2 p-2">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-4 animate-pulse bg-secondary" />
            ))}
          </div>
        ) : isError ? (
          <div className="p-2 text-xs text-terminal-red">
            EVENT FEED UNAVAILABLE — retrying
          </div>
        ) : events.length === 0 ? (
          <div className="p-2 text-xs text-terminal-dim">
            NO EVENTS YET — run AI analysis to generate pipeline events
          </div>
        ) : (
          <div className="flex flex-col gap-0.5 p-2">
            {events.map((event) => (
              <div
                key={event.id}
                className="flex items-start gap-2 text-xs leading-relaxed py-0.5"
              >
                <time
                  dateTime={event.timestamp}
                  className="text-terminal-dim w-6 shrink-0 text-right"
                  suppressHydrationWarning
                >
                  {formatTimeAgo(new Date(event.timestamp), now)}
                </time>
                <span
                  className={`shrink-0 font-bold ${getEventColor(event.category)}`}
                >
                  {getEventPrefix(event.category)}
                </span>
                <span className="text-muted-foreground truncate">
                  {event.message}
                </span>
                {event.asset && (
                  <span className="ml-auto shrink-0 text-terminal-amber">
                    {event.asset}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </ScrollArea>
    </section>
  );
}
