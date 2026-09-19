"use client";

import { useQuery } from "@tanstack/react-query";
import { FlashValue } from "@/components/flash-value";
import { useTerminalAuthenticated } from "@/components/terminal/terminal-auth-context";
import { useTerminalClock } from "@/hooks/use-terminal-clock";
import { APP_NAME, APP_VERSION } from "@/lib/constant";
import { activeTimezone } from "@/lib/date-utils";
import { fmtDollar } from "@/lib/format";
import { statusQueries } from "@/lib/queries/status";

/**
 * Terminal footer: agent fleet counts, open-position PnL, LLM spend,
 * active broker and a UTC clock. Live data via /api/status (30s poll);
 * a "--" placeholder keeps the layout stable while loading or if the DB
 * is unreachable.
 */
export function StatusBar() {
  const authed = useTerminalAuthenticated();
  const { data, isError } = useQuery(statusQueries.summary(authed));
  const { time: utcTime, date } = useTerminalClock({ intervalMs: 1000 });
  const tz = activeTimezone();

  const totalCount = data?.agents.total ?? 0;
  const onlineCount = data?.agents.online ?? 0;
  const totalPnl = data?.portfolio.totalPnl ?? 0;
  const activeBroker = data?.broker ?? {
    shortName: "--",
    status: "disconnected" as const,
  };
  const todayLlmCost = data?.llm.todayCost ?? 0;
  const totalLlmCost = data?.llm.totalCost ?? 0;

  const pnlPositive = totalPnl >= 0;

  return (
    <footer
      className="flex items-center justify-between border-t border-border bg-card px-3 py-1 text-xs overflow-hidden sm:px-4"
      style={{
        // Bottom-most chrome on mobile (renders after the bottom nav): keep
        // content clear of the iOS home indicator. Inert without
        // viewport-fit=cover, which the root viewport now sets.
        paddingBottom: "calc(0.25rem + env(safe-area-inset-bottom))",
      }}
    >
      <div className="flex items-center gap-2 overflow-hidden sm:gap-4">
        <span className="shrink-0 text-muted-foreground">
          {totalCount} agents
        </span>
        <span className="hidden text-muted-foreground sm:inline">|</span>
        <span className="hidden text-muted-foreground sm:inline">
          {onlineCount} active
        </span>
        <span className="hidden text-muted-foreground sm:inline">|</span>
        <span
          className={`shrink-0 ${
            isError
              ? "text-terminal-dim"
              : pnlPositive
                ? "text-terminal-green"
                : "text-terminal-red"
          }`}
        >
          P&L:{" "}
          {isError ? (
            "--"
          ) : (
            <FlashValue
              value={totalPnl}
              format={(n) => `${n >= 0 ? "+" : "-"}${fmtDollar(Math.abs(n))}`}
            />
          )}
        </span>
        <span className="hidden text-muted-foreground sm:inline">|</span>
        <span className="hidden shrink-0 text-muted-foreground sm:inline">
          LLM:{" "}
          {isError ? (
            "--"
          ) : (
            <span className="text-terminal-yellow">
              {fmtDollar(todayLlmCost)} / {fmtDollar(totalLlmCost)}
            </span>
          )}
        </span>
        <span className="hidden text-muted-foreground sm:inline">|</span>
        <span
          className={`hidden shrink-0 font-bold sm:inline ${
            activeBroker.status === "connected"
              ? "text-terminal-cyan"
              : "text-terminal-dim"
          }`}
        >
          {activeBroker.shortName}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-2 sm:gap-4">
        <span className="hidden text-muted-foreground sm:inline">
          {date} {utcTime} {tz}
        </span>
        <span className="tracking-wider text-terminal-green">
          {APP_NAME} {APP_VERSION}
        </span>
      </div>
    </footer>
  );
}
