"use client";

import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useTerminalAuthenticated } from "@/components/terminal/terminal-auth-context";
import { signalActivityQueries } from "@/lib/queries/signals";
import { ChartStatsFooter } from "./chart-stats-footer";

const WIDTH = 560;
const HEIGHT = 208;
const GAP = 2;

function SignalCardShell({
  header,
  children,
}: {
  header: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      aria-label="Signal activity chart"
      className="flex flex-col border border-border bg-card"
    >
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        {header}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

/**
 * Signal activity card: hourly signal counts over the last 24h (24 buckets,
 * oldest-first) from /api/signals/activity. Bars color by net sentiment —
 * green when bullish signals outnumber bearish, red otherwise. Pure SVG,
 * no chart library.
 */
export function SignalChart() {
  const authed = useTerminalAuthenticated();
  const { data, isError, isPending } = useQuery(
    signalActivityQueries.hourly(authed),
  );
  const buckets = data?.buckets ?? [];

  const hasData = buckets.some((b) => b.value > 0);
  const peak = buckets.reduce((m, b) => Math.max(m, b.value), 0);
  const total = buckets.reduce((s, b) => s + b.value, 0);
  const avg = buckets.length > 0 ? total / buckets.length : 0;
  const half = Math.floor(buckets.length / 2);
  const recent = buckets.slice(half).reduce((s, b) => s + b.value, 0);
  const older = buckets.slice(0, half).reduce((s, b) => s + b.value, 0);
  const trendPct = older > 0 ? ((recent - older) / older) * 100 : 0;

  const slot = buckets.length > 0 ? WIDTH / buckets.length : WIDTH;
  const barWidth = Math.max(2, slot - GAP);

  const header = (
    <div className="flex items-center gap-3">
      <h2 className="text-xs font-bold tracking-wider text-foreground">
        SIGNAL ACTIVITY
      </h2>
      <span className="hidden text-[10px] text-muted-foreground sm:inline">
        {data?.source === "events"
          ? "RUNTIME EVENTS (NO DB HISTORY)"
          : "LAST 24H"}
      </span>
      <span className="text-xs text-terminal-green">BULL</span>
      <span className="text-xs text-terminal-red">BEAR</span>
    </div>
  );

  return (
    <SignalCardShell header={header}>
      {isPending ? (
        <div
          className="animate-pulse bg-secondary"
          style={{ height: HEIGHT }}
          aria-hidden
        />
      ) : isError ? (
        <div
          className="flex items-center justify-center border border-terminal-red/30 bg-terminal-red/5 text-xs text-terminal-red"
          style={{ height: HEIGHT }}
        >
          SIGNAL DATA UNAVAILABLE — retrying
        </div>
      ) : !hasData ? (
        <div
          className="flex items-center justify-center border border-dashed border-border text-xs text-terminal-dim"
          style={{ height: HEIGHT }}
        >
          NO SIGNALS IN THE LAST 24H — run AI analysis to generate some
        </div>
      ) : (
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          className="w-full"
          style={{ height: HEIGHT }}
          role="img"
          aria-label={`Signal activity over ${buckets.length} hours, ${total} signals, trend ${trendPct.toFixed(1)} percent`}
          preserveAspectRatio="none"
        >
          {buckets.map((bucket, i) => {
            const barHeight =
              bucket.value > 0
                ? Math.max(2, (bucket.value / (peak || 1)) * (HEIGHT - 4))
                : 0;
            return (
              <rect
                key={bucket.time}
                x={i * slot + (slot - barWidth) / 2}
                y={HEIGHT - barHeight}
                width={barWidth}
                height={barHeight}
                fill={
                  bucket.net >= 0
                    ? "var(--terminal-green)"
                    : "var(--terminal-red)"
                }
                opacity={bucket.value > 0 ? 0.85 : 0.15}
              />
            );
          })}
        </svg>
      )}
      <ChartStatsFooter avg={avg} peak={peak} trendPct={trendPct} />
    </SignalCardShell>
  );
}
