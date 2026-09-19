"use client";

import { useQuery } from "@tanstack/react-query";
import {
  BarChart3,
  DollarSign,
  Target,
  TrendingDown,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { FlashValue } from "@/components/flash-value";
import { useTerminalAuthenticated } from "@/components/terminal/terminal-auth-context";
import { fmtDollar } from "@/lib/format";
import { statusQueries } from "@/lib/queries/status";

interface MetricCardProps {
  label: string;
  value: string;
  /** When set, the value flashes green/red whenever it changes between polls. */
  flashValue?: number;
  subValue?: string;
  trend?: "up" | "down" | "neutral";
  icon: React.ReactNode;
}

function MetricCard({
  label,
  value,
  flashValue,
  subValue,
  trend,
  icon,
}: MetricCardProps) {
  return (
    <div className="flex flex-col gap-1 border border-border bg-card p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs tracking-wider text-muted-foreground uppercase">
          {label}
        </span>
        <span className="text-muted-foreground">{icon}</span>
      </div>
      <div className="flex items-baseline gap-2">
        <span
          className={`text-lg font-bold ${
            trend === "up"
              ? "text-terminal-green"
              : trend === "down"
                ? "text-terminal-red"
                : "text-foreground"
          }`}
        >
          {flashValue !== undefined ? (
            <FlashValue value={flashValue} format={() => value} />
          ) : (
            value
          )}
        </span>
        {subValue && (
          <span
            className={`text-xs ${
              trend === "up"
                ? "text-terminal-green"
                : trend === "down"
                  ? "text-terminal-red"
                  : "text-muted-foreground"
            }`}
          >
            {subValue}
          </span>
        )}
      </div>
    </div>
  );
}

/** Signed percent helper: "+12.3%" / "-4.1%". */
function pct(n: number): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

export function PortfolioSummary() {
  const authed = useTerminalAuthenticated();
  const { data, isError, isPending } = useQuery(statusQueries.summary(authed));
  const p = data?.portfolio;

  if (isPending || !authed) {
    return (
      <section
        aria-label="Portfolio summary metrics"
        aria-busy="true"
        className="grid grid-cols-2 gap-px md:grid-cols-3 xl:grid-cols-6"
      >
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div
            key={i}
            className="flex flex-col gap-2 border border-border bg-card p-3"
          >
            <div className="h-3 w-20 animate-pulse bg-secondary" />
            <div className="h-5 w-24 animate-pulse bg-secondary" />
          </div>
        ))}
      </section>
    );
  }

  if (isError || !p) {
    return (
      <section
        aria-label="Portfolio summary metrics"
        className="grid grid-cols-2 gap-px md:grid-cols-3 xl:grid-cols-6"
      >
        <div className="flex items-center gap-2 border border-terminal-red/30 bg-terminal-red/5 p-3 text-xs text-terminal-red md:col-span-3 xl:col-span-6">
          PORTFOLIO DATA UNAVAILABLE — retrying
        </div>
      </section>
    );
  }

  return (
    <section
      aria-label="Portfolio summary metrics"
      className="grid grid-cols-2 gap-px md:grid-cols-3 xl:grid-cols-6"
    >
      <MetricCard
        label="TOTAL CAPITAL"
        value={fmtDollar(p.totalCapital)}
        subValue={`invested ${fmtDollar(p.investedCapital)}`}
        icon={<DollarSign className="h-3.5 w-3.5" />}
      />
      <MetricCard
        label="TOTAL P&L"
        value={fmtDollar(p.totalPnl)}
        flashValue={p.totalPnl}
        subValue={pct(p.totalPnlPct)}
        trend={p.totalPnl >= 0 ? "up" : "down"}
        icon={
          p.totalPnl >= 0 ? (
            <TrendingUp className="h-3.5 w-3.5" />
          ) : (
            <TrendingDown className="h-3.5 w-3.5" />
          )
        }
      />
      <MetricCard
        label="DAILY P&L"
        value={fmtDollar(p.dailyPnl)}
        flashValue={p.dailyPnl}
        trend={p.dailyPnl >= 0 ? "up" : "down"}
        icon={<BarChart3 className="h-3.5 w-3.5" />}
      />
      <MetricCard
        label="WEEKLY P&L"
        value={fmtDollar(p.weeklyPnl)}
        flashValue={p.weeklyPnl}
        trend={p.weeklyPnl >= 0 ? "up" : "down"}
        icon={
          p.weeklyPnl >= 0 ? (
            <TrendingUp className="h-3.5 w-3.5" />
          ) : (
            <TrendingDown className="h-3.5 w-3.5" />
          )
        }
      />
      <MetricCard
        label="AVAILABLE"
        value={fmtDollar(p.availableCapital)}
        subValue={
          p.totalCapital > 0
            ? `${((p.availableCapital / p.totalCapital) * 100).toFixed(1)}%`
            : "0.0%"
        }
        icon={<Wallet className="h-3.5 w-3.5" />}
      />
      <MetricCard
        label="POSITIONS"
        value={p.openPositionsCount.toString()}
        subValue={p.openPositionsCount > 0 ? "OPEN" : "NONE"}
        icon={<Target className="h-3.5 w-3.5" />}
      />
    </section>
  );
}
