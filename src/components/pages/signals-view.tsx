"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { SignalChart } from "@/components/dashboard/signal-chart";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  type RecentSignal,
  type SignalActivityResponse,
  signalActivityQueries,
} from "@/lib/queries/signals";
import { loadTerminalSettings } from "@/lib/terminal-settings";

// -- helpers ----------------------------------------------------------------

const AVAILABLE_SOURCES = ["reddit", "twitter", "rss"] as const;
const SENTIMENTS = ["bullish", "bearish", "neutral"] as const;
const MAX_LIST_ROWS = 100;
const EMPTY_SIGNALS: RecentSignal[] = [];

function getSourceBadge(source: RecentSignal["source"]) {
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

function getSourceLetter(source: RecentSignal["source"]) {
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

function getSentimentColor(sentiment: RecentSignal["sentiment"]) {
  switch (sentiment) {
    case "bullish":
      return "text-terminal-green";
    case "bearish":
      return "text-terminal-red";
    case "neutral":
      return "text-terminal-amber";
  }
}

function formatTimeAgo(date: Date, nowMs: number) {
  const seconds = Math.max(0, Math.floor((nowMs - date.getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}

// -- Signal row -------------------------------------------------------------

function SignalRow({
  signal,
  threshold,
  now,
}: {
  signal: RecentSignal;
  threshold: number;
  now: number;
}) {
  const triggered = signal.score >= threshold;
  return (
    <div className="flex items-start gap-3 border-b border-border/50 px-4 py-2 hover:bg-secondary/30 transition-colors">
      <div
        className={`flex h-5 w-5 shrink-0 items-center justify-center text-[10px] font-bold ${getSourceBadge(signal.source)}`}
      >
        {getSourceLetter(signal.source)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-bold text-foreground">
            {signal.asset}
          </span>
          <span
            className={`text-[10px] font-bold uppercase ${getSentimentColor(signal.sentiment)}`}
          >
            {signal.sentiment}
          </span>
          <span
            className={`text-[10px] font-bold ${triggered ? "text-terminal-green" : "text-muted-foreground"}`}
          >
            {signal.score}/100
          </span>
          {triggered && (
            <span className="text-[10px] font-bold text-terminal-amber">
              TRIGGERED
            </span>
          )}
          {signal.twitterConfirmed && (
            <span className="text-[10px] text-terminal-cyan">X CONFIRMED</span>
          )}
        </div>
        <p className="mt-0.5 truncate text-[11px] leading-relaxed text-muted-foreground">
          {signal.content}
        </p>
      </div>
      <time
        dateTime={signal.createdAt}
        className="shrink-0 text-[10px] text-terminal-dim"
        suppressHydrationWarning
      >
        {formatTimeAgo(new Date(signal.createdAt), now)}
      </time>
    </div>
  );
}

// -- Stat card --------------------------------------------------------------

function StatCard({
  label,
  value,
  color = "text-foreground",
  sub,
}: {
  label: string;
  value: string;
  color?: string;
  sub?: string;
}) {
  return (
    <div className="flex flex-col gap-1 border border-border bg-card p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs tracking-wider text-muted-foreground uppercase">
          {label}
        </span>
      </div>
      <div className="flex items-baseline gap-2">
        <span className={`text-lg font-bold ${color}`}>{value}</span>
        {sub && <span className="text-xs text-muted-foreground">{sub}</span>}
      </div>
    </div>
  );
}

// -- Main view --------------------------------------------------------------

function computeSignalStats(
  signals: RecentSignal[],
  threshold: number,
  activity: SignalActivityResponse | undefined,
) {
  const total = signals.length;
  const bullish = signals.filter((s) => s.sentiment === "bullish").length;
  const bearish = signals.filter((s) => s.sentiment === "bearish").length;
  const triggered = signals.filter((s) => s.score >= threshold).length;
  const avgScore =
    total > 0 ? signals.reduce((sum, s) => sum + s.score, 0) / total : 0;
  const total24h = activity?.buckets.reduce((sum, b) => sum + b.value, 0) ?? 0;
  const net24h = activity?.buckets.reduce((sum, b) => sum + b.net, 0) ?? 0;
  return { total, bullish, bearish, triggered, avgScore, total24h, net24h };
}

function SignalsToolbar({
  isPending,
  isError,
  totalCount,
  shownCount,
  source,
  threshold,
}: {
  isPending: boolean;
  isError: boolean;
  totalCount: number;
  shownCount: number;
  source: "db" | "events" | undefined;
  threshold: number;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-card px-3 py-2 sm:px-4">
      <div className="flex items-center gap-3">
        <h1 className="text-xs font-bold tracking-wider text-foreground">
          SIGNAL FEED
        </h1>
        <span className="text-[10px] text-muted-foreground">
          {isPending
            ? "loading..."
            : isError
              ? "offline"
              : `${totalCount} signals · ${shownCount} shown`}
        </span>
        <span
          className={`text-[10px] font-bold ${
            source === "events"
              ? "text-terminal-amber"
              : "text-muted-foreground"
          }`}
        >
          {source === "events" ? "RUNTIME EVENTS (NO DB HISTORY)" : ""}
        </span>
      </div>
      <span className="text-[10px] text-muted-foreground">
        ALERT THRESHOLD{" "}
        <span className="font-bold text-terminal-amber">{threshold}</span>
      </span>
    </div>
  );
}

function SignalsStats({
  stats,
  threshold,
}: {
  stats: ReturnType<typeof computeSignalStats>;
  threshold: number;
}) {
  return (
    <div className="grid grid-cols-2 gap-px border-b border-border md:grid-cols-3 xl:grid-cols-6">
      <StatCard
        label="SIGNALS (LOADED)"
        value={stats.total.toString()}
        sub="newest 30"
      />
      <StatCard
        label="TRIGGERED"
        value={stats.triggered.toString()}
        color="text-terminal-amber"
        sub={`>= ${threshold}`}
      />
      <StatCard
        label="BULLISH"
        value={stats.bullish.toString()}
        color="text-terminal-green"
      />
      <StatCard
        label="BEARISH"
        value={stats.bearish.toString()}
        color="text-terminal-red"
      />
      <StatCard
        label="AVG SCORE"
        value={stats.avgScore.toFixed(1)}
        sub="0-100"
      />
      <StatCard
        label="24H ACTIVITY"
        value={stats.total24h.toString()}
        sub={`${stats.net24h >= 0 ? "+" : ""}${stats.net24h} net`}
        color={stats.net24h >= 0 ? "text-terminal-green" : "text-terminal-red"}
      />
    </div>
  );
}

function SignalsFiltersRow({
  assets,
  assetFilter,
  sourceFilters,
  sentimentFilter,
  triggeredOnly,
  onAssetChange,
  onSourceToggle,
  onSentimentChange,
  onTriggeredOnlyChange,
  onClear,
}: {
  assets: string[];
  assetFilter: string;
  sourceFilters: string[];
  sentimentFilter: string;
  triggeredOnly: boolean;
  onAssetChange: (v: string) => void;
  onSourceToggle: (source: string) => void;
  onSentimentChange: (v: string) => void;
  onTriggeredOnlyChange: () => void;
  onClear: () => void;
}) {
  const clearVisible =
    assetFilter !== "ALL" ||
    sourceFilters.length > 0 ||
    sentimentFilter !== "ALL" ||
    triggeredOnly;

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border bg-card px-4 py-2">
      {/* Asset filter */}
      <div className="flex items-center gap-1">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
          ASSET
        </span>
        <select
          value={assetFilter}
          onChange={(e) => onAssetChange(e.target.value)}
          aria-label="ASSET"
          className="border border-border bg-secondary px-2 py-0.5 text-[10px] font-bold text-foreground outline-none"
        >
          <option value="ALL">ALL</option>
          {assets.map((asset) => (
            <option key={asset} value={asset}>
              {asset}
            </option>
          ))}
        </select>
      </div>

      {/* Source chips */}
      <div className="flex items-center gap-1">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
          SOURCE
        </span>
        {AVAILABLE_SOURCES.map((source) => {
          const active = sourceFilters.includes(source);
          return (
            <button
              key={source}
              type="button"
              onClick={() => onSourceToggle(source)}
              className={`px-2 py-0.5 text-[10px] font-bold uppercase border transition-colors ${
                active
                  ? "border-terminal-green/40 bg-terminal-green/10 text-terminal-green"
                  : "border-border bg-secondary text-muted-foreground hover:text-foreground"
              }`}
            >
              {source}
            </button>
          );
        })}
      </div>

      {/* Sentiment chips */}
      <div className="flex items-center gap-1">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
          SENTIMENT
        </span>
        {SENTIMENTS.map((sentiment) => {
          const active = sentimentFilter === sentiment;
          return (
            <button
              key={sentiment}
              type="button"
              onClick={() => onSentimentChange(active ? "ALL" : sentiment)}
              className={`px-2 py-0.5 text-[10px] font-bold uppercase border transition-colors ${
                active
                  ? getSentimentColor(sentiment) +
                    " border-current bg-current/10"
                  : "border-border bg-secondary text-muted-foreground hover:text-foreground"
              }`}
            >
              {sentiment}
            </button>
          );
        })}
      </div>

      {/* Triggered-only toggle */}
      <button
        type="button"
        onClick={onTriggeredOnlyChange}
        className={`px-2 py-0.5 text-[10px] font-bold uppercase border transition-colors ${
          triggeredOnly
            ? "border-terminal-amber/40 bg-terminal-amber/10 text-terminal-amber"
            : "border-border bg-secondary text-muted-foreground hover:text-foreground"
        }`}
      >
        TRIGGERED ONLY
      </button>

      {clearVisible && (
        <button
          type="button"
          onClick={onClear}
          className="ml-auto text-[10px] uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
        >
          Clear filters
        </button>
      )}
    </div>
  );
}

function SignalsList({
  isPending,
  isError,
  filteredSignals,
  signalsLength,
  threshold,
  now,
}: {
  isPending: boolean;
  isError: boolean;
  filteredSignals: RecentSignal[];
  signalsLength: number;
  threshold: number;
  now: number;
}) {
  return (
    <ScrollArea className="flex-1">
      {isPending ? (
        <div className="flex flex-col">
          {[0, 1, 2, 3, 4, 5].map((i) => (
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
      ) : filteredSignals.length === 0 ? (
        <div className="p-4 text-xs text-terminal-dim">
          {signalsLength === 0
            ? "NO SIGNALS YET — run AI analysis to generate some"
            : "NO SIGNALS MATCH THE CURRENT FILTERS"}
        </div>
      ) : (
        <div className="flex flex-col">
          {filteredSignals.map((signal) => (
            <SignalRow
              key={signal.id}
              signal={signal}
              threshold={threshold}
              now={now}
            />
          ))}
        </div>
      )}
    </ScrollArea>
  );
}

export function SignalsView() {
  const {
    data: recent,
    isError,
    isPending,
  } = useQuery(signalActivityQueries.recent());
  const { data: activity } = useQuery(signalActivityQueries.hourly());

  // Threshold comes from terminal settings (localStorage); lazy-init keeps it
  // SSR-safe without a post-hydration setState, so no value flickers.
  const [threshold] = useState(() => loadTerminalSettings().alertThreshold);

  // Clock tick keeps relative timestamps fresh between fetches.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);

  // Filters
  const [assetFilter, setAssetFilter] = useState<string>("ALL");
  const [sourceFilters, setSourceFilters] = useState<string[]>([]);
  const [sentimentFilter, setSentimentFilter] = useState<string>("ALL");
  const [triggeredOnly, setTriggeredOnly] = useState(false);

  const signals = recent?.items ?? EMPTY_SIGNALS;

  const filteredSignals = useMemo(() => {
    const sourceFilterSet = new Set(sourceFilters);
    const list = signals.filter((s) => {
      if (assetFilter !== "ALL" && s.asset !== assetFilter) return false;
      if (sourceFilters.length > 0 && !sourceFilterSet.has(s.source as string))
        return false;
      if (sentimentFilter !== "ALL" && s.sentiment !== sentimentFilter)
        return false;
      if (triggeredOnly && s.score < threshold) return false;
      return true;
    });
    return list.slice(0, MAX_LIST_ROWS);
  }, [
    signals,
    assetFilter,
    sourceFilters,
    sentimentFilter,
    triggeredOnly,
    threshold,
  ]);

  const assets = useMemo(() => {
    const set = new Set<string>();
    for (const s of signals) {
      set.add(s.asset);
    }
    return [...set].sort();
  }, [signals]);

  // Headline stats — computed from the full (unfiltered) signal list, with
  // the 24h activity totals as secondary context.
  const stats = useMemo(
    () => computeSignalStats(signals, threshold, activity),
    [signals, activity, threshold],
  );

  function clearFilters() {
    setAssetFilter("ALL");
    setSourceFilters([]);
    setSentimentFilter("ALL");
    setTriggeredOnly(false);
  }

  return (
    <div className="flex h-full flex-col">
      <SignalsToolbar
        isPending={isPending}
        isError={isError}
        totalCount={signals.length}
        shownCount={filteredSignals.length}
        source={recent?.source}
        threshold={threshold}
      />

      <SignalsStats stats={stats} threshold={threshold} />

      {/* Activity chart */}
      <div className="border-b border-border p-px">
        <SignalChart />
      </div>

      <SignalsFiltersRow
        assets={assets}
        assetFilter={assetFilter}
        sourceFilters={sourceFilters}
        sentimentFilter={sentimentFilter}
        triggeredOnly={triggeredOnly}
        onAssetChange={setAssetFilter}
        onSourceToggle={(source) =>
          setSourceFilters((prev) =>
            prev.includes(source)
              ? prev.filter((s) => s !== source)
              : [...prev, source],
          )
        }
        onSentimentChange={setSentimentFilter}
        onTriggeredOnlyChange={() => setTriggeredOnly((v) => !v)}
        onClear={clearFilters}
      />

      <SignalsList
        isPending={isPending}
        isError={isError}
        filteredSignals={filteredSignals}
        signalsLength={signals.length}
        threshold={threshold}
        now={now}
      />
    </div>
  );
}
