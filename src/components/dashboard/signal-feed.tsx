"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useState, useSyncExternalStore } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  type RecentSignal,
  signalActivityQueries,
} from "@/lib/queries/signals";
import { loadTerminalSettings } from "@/lib/terminal-settings";

function subscribeToSettingsChanges(callback: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("viipers:settings-changed", callback);
  return () => window.removeEventListener("viipers:settings-changed", callback);
}

function getSourceIcon(source: RecentSignal["source"]) {
  switch (source) {
    case "reddit":
      return "R";
    case "twitter":
      return "X";
    case "rss":
      return "F";
    default:
      return "?";
  }
}

function getSourceColor(source: RecentSignal["source"]) {
  switch (source) {
    case "reddit":
      return "bg-orange-500/20 text-orange-400";
    case "twitter":
      return "bg-terminal-cyan/20 text-terminal-cyan";
    case "rss":
      return "bg-terminal-amber/20 text-terminal-amber";
    default:
      return "bg-muted text-muted-foreground";
  }
}

function getSentimentColor(sentiment: RecentSignal["sentiment"]) {
  switch (sentiment) {
    case "bullish":
      return "text-terminal-green";
    case "bearish":
      return "text-terminal-red";
    case "neutral":
      return "text-terminal-amber";
    default:
      return "text-muted-foreground";
  }
}

function formatTimeAgo(date: Date, nowMs: number) {
  const seconds = Math.max(0, Math.floor((nowMs - date.getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}

const MAX_FEED_ROWS = 30;

export function SignalFeed() {
  const { data, isError, isPending } = useQuery(signalActivityQueries.recent());
  // Threshold comes from terminal settings (localStorage). useSyncExternalStore
  // reads it render-safely — hydration reconciles in one extra synchronous
  // pre-paint pass, so there is no post-mount flash of the default threshold.
  // The viipers:settings-changed DOM event keeps it live when /settings edits.
  const threshold = useSyncExternalStore(
    subscribeToSettingsChanges,
    () => loadTerminalSettings().alertThreshold,
  );

  // Poll the clock so relative "time ago" labels stay fresh between fetches.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);

  const signals = (data?.items ?? []).slice(0, MAX_FEED_ROWS);
  const sortedSignals = signals; // API returns newest-first already.
  const triggeredCount = signals.filter((s) => s.score >= threshold).length;

  return (
    <section
      aria-label="Signal feed"
      className="flex flex-1 min-h-0 flex-col border border-border bg-card"
    >
      <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-2">
        <Tooltip>
          <TooltipTrigger
            render={
              <h2 className="text-xs font-bold tracking-wider text-foreground cursor-help">
                SIGNAL FEED
              </h2>
            }
          />
          <TooltipContent
            side="bottom"
            sideOffset={6}
            className="bg-card text-muted-foreground border border-border text-xs max-w-64"
          >
            Live stream of sentiment signals from Reddit, X, and RSS sources
            with confidence scores
          </TooltipContent>
        </Tooltip>
        <span className="text-xs text-terminal-amber">
          {isPending ? "..." : `${triggeredCount} triggered`}
        </span>
      </div>
      <ScrollArea className="flex-1 min-h-0">
        {isPending ? (
          <div className="flex flex-col">
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-12 animate-pulse bg-secondary border-b border-border/50"
              />
            ))}
          </div>
        ) : isError ? (
          <div className="p-4 text-xs text-terminal-red">
            SIGNAL FEED UNAVAILABLE — retrying
          </div>
        ) : sortedSignals.length === 0 ? (
          <div className="p-4 text-xs text-terminal-dim">
            NO SIGNALS YET — run AI analysis to generate some
          </div>
        ) : (
          <div className="flex flex-col">
            {sortedSignals.map((signal) => (
              <div
                key={signal.id}
                className="flex items-start gap-3 border-b border-border/50 px-4 py-2 hover:bg-secondary/30 transition-colors cursor-pointer"
              >
                <div
                  className={`flex h-5 w-5 shrink-0 items-center justify-center text-[10px] font-bold ${getSourceColor(signal.source)}`}
                >
                  {getSourceIcon(signal.source)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-foreground">
                      {signal.asset}
                    </span>
                    <span
                      className={`text-[10px] uppercase font-bold ${getSentimentColor(signal.sentiment)}`}
                    >
                      {signal.sentiment}
                    </span>
                    <span
                      className={`text-[10px] font-bold ${
                        signal.score >= threshold
                          ? "text-terminal-green"
                          : "text-muted-foreground"
                      }`}
                    >
                      {signal.score}/100
                    </span>
                    {signal.twitterConfirmed && (
                      <span className="text-[10px] text-terminal-cyan">
                        X CONFIRMED
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-[11px] text-muted-foreground leading-relaxed truncate">
                    {signal.content}
                  </p>
                </div>
                <time
                  dateTime={signal.createdAt}
                  className="text-[10px] text-terminal-dim shrink-0"
                  suppressHydrationWarning
                >
                  {formatTimeAgo(new Date(signal.createdAt), now)}
                </time>
              </div>
            ))}
          </div>
        )}
      </ScrollArea>
    </section>
  );
}
