"use client";

import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  Crown,
  Medal,
  Skull,
  TrendingDown,
  TrendingUp,
  Trophy,
} from "lucide-react";
import { useMemo } from "react";
import { Sparkline } from "@/components/dashboard/sparkline";
import { ScrollArea } from "@/components/ui/scroll-area";
import { fmtPnl } from "@/lib/format";
import { type AgentFleetEntry, agentsDbQueries } from "@/lib/queries/agents-db";

// -- helpers ----------------------------------------------------------------

/** Ranked agent = fleet entry + resolved leaderboard score. */
type RankedAgent = AgentFleetEntry & {
  /** Resolved score: persisted value, or the provisional client composite. */
  score: number;
  /** True when the score is the client-side heuristic, not the persisted one. */
  provisional: boolean;
};

/**
 * Mirrors `src/lib/leaderboard-score.ts` (server-owned, persisted by the
 * leaderboard-score job). Duplicated client-side ONLY as a provisional
 * fallback for the window before the job's first run has populated
 * `agent_stats.score`; ranking authority is the persisted value.
 *
 * Includes the trade-count activity floor: below MIN_TRADES closed trades
 * the composite is scaled down linearly, so a one-trade lucky streak can't
 * top the ranking. Weights mirror the original mock: ROI and risk-adjusted
 * return dominate, activity breaks ties. `maxDrawdown` is a positive loss
 * magnitude in this schema, so deeper drawdowns subtract.
 */
const MIN_TRADES = 10;

function resolveScore(agent: AgentFleetEntry): RankedAgent {
  if (agent.stats.score !== null) {
    return {
      ...agent,
      provisional: false,
      score: agent.stats.score,
    };
  }

  const s = agent.stats;
  const roiScore = Math.min(Math.max(s.roi, 0) / 50, 1) * 100;
  const sharpeScore = Math.min(Math.max(s.sharpe, 0) / 3, 1) * 100;
  const wrScore = Math.min(Math.max(s.winRate, 0), 100);
  const ddScore = Math.max(0, 100 - s.maxDrawdown * 3);
  const trScore = Math.min(s.trades / 200, 1) * 100;
  const activityFactor = Math.min(Math.max(s.trades, 0) / MIN_TRADES, 1);
  return {
    ...agent,
    provisional: true,
    score: Math.round(
      (roiScore * 0.3 +
        sharpeScore * 0.25 +
        wrScore * 0.2 +
        ddScore * 0.15 +
        trScore * 0.1) *
        activityFactor,
    ),
  };
}

function getTeamBadge(team: AgentFleetEntry["team"]) {
  switch (team) {
    case "SENTIMENT":
      return {
        className: "bg-terminal-cyan/10 text-terminal-cyan",
        label: "SENTIMENT",
      };
    case "ANALYSIS":
      return {
        className: "bg-terminal-amber/10 text-terminal-amber",
        label: "ANALYSIS",
      };
    case "EXECUTION":
      return {
        className: "bg-terminal-green/10 text-terminal-green",
        label: "EXECUTION",
      };
    case "RISK":
      return {
        className: "bg-terminal-red/10 text-terminal-red",
        label: "RISK",
      };
    case "COORDINATION":
      return {
        className: "bg-terminal-gold/10 text-terminal-gold",
        label: "COORD",
      };
  }
}

function getStatusDot(status: AgentFleetEntry["status"]) {
  switch (status) {
    case "online":
      return "bg-terminal-green";
    case "busy":
      return "bg-terminal-amber";
    case "error":
      return "bg-terminal-red";
    default:
      return "bg-terminal-dim";
  }
}

function displayName(agent: AgentFleetEntry): string {
  return agent.codename ?? agent.id;
}

// -- Champion card ----------------------------------------------------------

function ChampionCard({ agent, rank }: { agent: RankedAgent; rank: number }) {
  const isFirst = rank === 1;
  const badge = getTeamBadge(agent.team);

  return (
    <div
      className={`relative border bg-card p-4 ${
        isFirst ? "col-span-full border-terminal-gold/50" : "border-border"
      }`}
    >
      {/* Rank badge */}
      <div
        className={`absolute -top-3 left-4 flex items-center gap-1.5 px-2 py-0.5 text-xs font-bold tracking-wider ${
          isFirst
            ? "bg-terminal-gold/20 text-terminal-gold"
            : rank === 2
              ? "bg-foreground/10 text-foreground"
              : "bg-terminal-amber/10 text-terminal-amber"
        }`}
      >
        {isFirst ? (
          <Crown className="h-3 w-3" />
        ) : (
          <Medal className="h-3 w-3" />
        )}
        {isFirst ? "REIGNING CHAMPION" : rank === 2 ? "2ND PLACE" : "3RD PLACE"}
      </div>

      <div className="mt-2 flex items-start justify-between">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <div
              className={`h-2 w-2 rounded-full ${getStatusDot(agent.status)}`}
            />
            <span
              className={`text-sm font-bold tracking-wider ${
                isFirst ? "text-terminal-gold terminal-glow" : "text-foreground"
              }`}
            >
              {displayName(agent)}
            </span>
          </div>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {badge.label} / {agent.role.replace(/_/g, " ")}
          </span>
        </div>
        <div className="flex flex-col items-end gap-0.5">
          <span
            className={`text-2xl font-bold ${
              isFirst ? "text-terminal-gold terminal-glow" : "text-foreground"
            }`}
          >
            {agent.score}
            {agent.provisional && (
              <sup className="ml-0.5 text-[10px] text-terminal-amber">*</sup>
            )}
          </span>
          <span className="text-[10px] tracking-wider text-muted-foreground">
            SCORE
          </span>
          <span
            className={`text-[10px] tracking-wider ${
              agent.stats.trades < MIN_TRADES
                ? "text-terminal-amber"
                : "text-muted-foreground"
            }`}
          >
            {agent.stats.trades} TRADES
            {agent.stats.trades < MIN_TRADES ? ` / FLOOR ${MIN_TRADES}` : ""}
          </span>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-3 text-xs sm:grid-cols-5">
        <div className="flex flex-col">
          <span className="text-[10px] tracking-wider text-muted-foreground">
            P&L
          </span>
          <span
            className={`font-bold ${
              agent.stats.pnl >= 0 ? "text-terminal-green" : "text-terminal-red"
            }`}
          >
            {fmtPnl(agent.stats.pnl)}
          </span>
        </div>
        <div className="flex flex-col">
          <span className="text-[10px] tracking-wider text-muted-foreground">
            ROI
          </span>
          <span
            className={`font-bold ${
              agent.stats.roi >= 0 ? "text-terminal-green" : "text-terminal-red"
            }`}
          >
            {agent.stats.roi >= 0 ? "+" : ""}
            {agent.stats.roi.toFixed(1)}%
          </span>
        </div>
        <div className="flex flex-col">
          <span className="text-[10px] tracking-wider text-muted-foreground">
            SHARPE
          </span>
          <span className="font-bold text-foreground">
            {agent.stats.sharpe.toFixed(2)}
          </span>
        </div>
        <div className="flex flex-col">
          <span className="text-[10px] tracking-wider text-muted-foreground">
            WIN RATE
          </span>
          <span className="font-bold text-foreground">
            {agent.stats.winRate.toFixed(1)}%
          </span>
        </div>
        <div className="flex flex-col">
          <span className="text-[10px] tracking-wider text-muted-foreground">
            MDD
          </span>
          <span className="font-bold text-terminal-red">
            {agent.stats.maxDrawdown.toFixed(1)}%
          </span>
        </div>
      </div>

      {agent.stats.equityData.length >= 2 &&
        (isFirst ? (
          <div className="mt-3 w-full overflow-hidden">
            <Sparkline
              data={agent.stats.equityData}
              width={600}
              height={40}
              color="#ffd700"
              className="h-auto w-full"
            />
          </div>
        ) : (
          <div className="mt-3">
            <Sparkline data={agent.stats.equityData} width={280} height={32} />
          </div>
        ))}
    </div>
  );
}

// -- Tier divider -----------------------------------------------------------

function CategoryDivider({
  label,
  icon,
}: {
  label: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 border-y border-border bg-secondary/30 px-4 py-2">
      {icon}
      <span className="text-[10px] font-bold tracking-[0.2em] text-muted-foreground">
        {label}
      </span>
      <div className="flex-1 border-t border-border/50" />
    </div>
  );
}

// -- Ranked row -------------------------------------------------------------

function AgentRow({ agent, rank }: { agent: RankedAgent; rank: number }) {
  const badge = getTeamBadge(agent.team);
  const equity = agent.stats.equityData;
  const trend = equity.length >= 2 && equity[equity.length - 1] >= equity[0];

  return (
    <tr className="group cursor-pointer border-b border-border/50 text-xs transition-colors hover:bg-secondary/30">
      <td className="w-12 px-3 py-2.5 font-bold text-muted-foreground sm:px-4">
        {String(rank).padStart(2, "0")}
      </td>
      <td className="px-3 py-2.5 sm:px-4">
        <div className="flex items-center gap-2">
          <div
            className={`h-1.5 w-1.5 rounded-full ${getStatusDot(agent.status)}`}
          />
          <span className="font-bold tracking-wide text-foreground">
            {displayName(agent)}
          </span>
        </div>
      </td>
      <td className="px-3 py-2.5 sm:px-4">
        <span
          className={`px-1.5 py-0.5 text-[10px] font-bold ${badge.className}`}
        >
          {badge.label}
        </span>
      </td>
      <td className="px-3 py-2.5 text-right sm:px-4">
        <span className="font-bold text-terminal-gold">
          {agent.score}
          {agent.provisional && (
            <sup className="ml-0.5 text-[8px] text-terminal-amber">*</sup>
          )}
        </span>
      </td>
      <td
        className={`px-3 py-2.5 text-right font-bold sm:px-4 ${
          agent.stats.pnl >= 0 ? "text-terminal-green" : "text-terminal-red"
        }`}
      >
        {fmtPnl(agent.stats.pnl)}
      </td>
      <td
        className={`px-3 py-2.5 text-right sm:px-4 ${
          agent.stats.roi >= 0 ? "text-terminal-green" : "text-terminal-red"
        }`}
      >
        {agent.stats.roi >= 0 ? "+" : ""}
        {agent.stats.roi.toFixed(1)}%
      </td>
      <td className="hidden px-4 py-2.5 text-right text-foreground md:table-cell">
        {agent.stats.sharpe.toFixed(2)}
      </td>
      <td className="px-3 py-2.5 text-right text-foreground sm:px-4">
        {agent.stats.winRate.toFixed(1)}%
      </td>
      <td className="hidden px-4 py-2.5 text-right text-terminal-red md:table-cell">
        {agent.stats.maxDrawdown.toFixed(1)}%
      </td>
      <td className="hidden px-4 py-2.5 text-right text-muted-foreground lg:table-cell">
        {agent.stats.trades}
      </td>
      <td className="hidden px-4 py-2.5 text-right lg:table-cell">
        <div className="flex items-center justify-end gap-1.5">
          {equity.length >= 2 ? (
            <>
              <Sparkline data={equity} width={80} height={20} />
              {trend ? (
                <TrendingUp className="h-3 w-3 text-terminal-green" />
              ) : (
                <TrendingDown className="h-3 w-3 text-terminal-red" />
              )}
            </>
          ) : (
            <span className="text-[10px] text-terminal-dim">—</span>
          )}
        </div>
      </td>
    </tr>
  );
}

const RANKED_TABLE_HEADER = (
  <thead>
    <tr className="border-b border-border text-[10px] tracking-wider text-muted-foreground">
      <th scope="col" className="px-3 py-2 text-left font-normal sm:px-4">
        RANK
      </th>
      <th scope="col" className="px-3 py-2 text-left font-normal sm:px-4">
        FIGHTER
      </th>
      <th scope="col" className="px-3 py-2 text-left font-normal sm:px-4">
        TEAM
      </th>
      <th scope="col" className="px-3 py-2 text-right font-normal sm:px-4">
        SCORE
      </th>
      <th scope="col" className="px-3 py-2 text-right font-normal sm:px-4">
        P&L
      </th>
      <th scope="col" className="px-3 py-2 text-right font-normal sm:px-4">
        ROI%
      </th>
      <th
        scope="col"
        className="hidden px-4 py-2 text-right font-normal md:table-cell"
      >
        SHARPE
      </th>
      <th scope="col" className="px-3 py-2 text-right font-normal sm:px-4">
        WIN RATE
      </th>
      <th
        scope="col"
        className="hidden px-4 py-2 text-right font-normal md:table-cell"
      >
        MDD
      </th>
      <th
        scope="col"
        className="hidden px-4 py-2 text-right font-normal lg:table-cell"
      >
        TRADES
      </th>
      <th
        scope="col"
        className="hidden px-4 py-2 text-right font-normal lg:table-cell"
      >
        EQUITY TREND
      </th>
    </tr>
  </thead>
);

// -- Main view --------------------------------------------------------------

export function LeaderboardView() {
  const { data, isError, isPending } = useQuery(agentsDbQueries.fleet());

  const ranked = useMemo(
    () =>
      (data?.items ?? []).map(resolveScore).sort((a, b) => b.score - a.score),
    [data],
  );
  const hasPersistedScores = ranked.some((a) => !a.provisional);
  const minTradesShown = ranked.reduce(
    (min, a) => Math.min(min, a.stats.trades),
    Number.POSITIVE_INFINITY,
  );

  const champion = ranked[0];
  const second = ranked[1];
  const third = ranked[2];
  const eliteRest = ranked.slice(3, 6);
  const contenders = ranked.slice(6, 9);
  const proving = ranked.slice(9);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex flex-col gap-2 border-b border-border bg-card px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-4">
        <div className="flex items-center gap-3">
          <Trophy className="h-4 w-4 text-terminal-gold" />
          <h1 className="text-xs font-bold tracking-[0.15em] text-foreground">
            AGENT PERFORMANCE RANKING
          </h1>
          <span className="text-[10px] text-muted-foreground">
            {isPending
              ? "loading..."
              : isError
                ? "offline"
                : `${ranked.length} AGENTS`}
          </span>
        </div>
        <div className="flex items-center gap-3 text-xs sm:gap-4">
          <span className="text-muted-foreground">
            <Activity className="mr-1 inline h-3 w-3" />
            FLOOR {MIN_TRADES} TRADES
          </span>
          <span className="text-terminal-green">
            {ranked.filter((a) => a.stats.pnl > 0).length} PROFITABLE
          </span>
          <span className="text-terminal-red">
            {ranked.filter((a) => a.stats.pnl < 0).length} IN LOSS
          </span>
        </div>
      </div>

      <ScrollArea className="flex-1">
        {isPending ? (
          <div className="flex flex-col gap-4 p-3 sm:p-4">
            <div className="h-44 animate-pulse bg-secondary" />
            <div className="h-36 animate-pulse bg-secondary" />
            <div className="h-64 animate-pulse bg-secondary" />
          </div>
        ) : isError ? (
          <div className="flex flex-col items-center justify-center py-20 text-terminal-red">
            <span className="text-xs uppercase tracking-wider">
              LEADERBOARD DATA UNAVAILABLE — retrying
            </span>
          </div>
        ) : ranked.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
            <span className="text-xs uppercase tracking-wider">
              No agents configured
            </span>
          </div>
        ) : (
          <div className="p-3 sm:p-4">
            {hasPersistedScores ? null : (
              <div className="mb-3 border border-terminal-amber/30 bg-terminal-amber/5 px-3 py-1.5 text-[10px] text-terminal-amber">
                {"// "}PROVISIONAL RANKING — scores not yet persisted by the
                leaderboard job; the activity floor still applies
              </div>
            )}
            {minTradesShown < MIN_TRADES && (
              <div className="mb-3 border border-border bg-secondary/30 px-3 py-1.5 text-[10px] text-muted-foreground">
                {"// "}AGENTS UNDER {MIN_TRADES} CLOSED TRADES ARE SCORE-SCALED
                DOWN (ACTIVITY FLOOR)
              </div>
            )}
            {/* Top 3 cards */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:gap-6">
              {champion && <ChampionCard agent={champion} rank={1} />}
              {second && <ChampionCard agent={second} rank={2} />}
              {third && <ChampionCard agent={third} rank={3} />}
            </div>

            {/* Ranked table */}
            <div className="mt-6 overflow-x-auto border border-border">
              {/* Elite */}
              {eliteRest.length > 0 && (
                <>
                  <CategoryDivider
                    label="ELITE TOP CONTENDERS"
                    icon={<Crown className="h-3 w-3 text-terminal-gold" />}
                  />
                  <table className="w-full min-w-150">
                    {RANKED_TABLE_HEADER}
                    <tbody>
                      {eliteRest.map((agent, i) => (
                        <AgentRow key={agent.id} agent={agent} rank={i + 4} />
                      ))}
                    </tbody>
                  </table>
                </>
              )}

              {/* Contenders */}
              {contenders.length > 0 && (
                <>
                  <CategoryDivider
                    label="CONTENDERS FIGHTING FOR POSITION"
                    icon={<TrendingUp className="h-3 w-3 text-terminal-cyan" />}
                  />
                  <table className="w-full min-w-150">
                    <tbody>
                      {contenders.map((agent, i) => (
                        <AgentRow key={agent.id} agent={agent} rank={i + 7} />
                      ))}
                    </tbody>
                  </table>
                </>
              )}

              {/* Proving grounds */}
              {proving.length > 0 && (
                <>
                  <CategoryDivider
                    label="PROVING GROUNDS ADAPT OR DIE"
                    icon={<Skull className="h-3 w-3 text-terminal-red" />}
                  />
                  <table className="w-full min-w-150">
                    <tbody>
                      {proving.map((agent, i) => (
                        <AgentRow key={agent.id} agent={agent} rank={i + 10} />
                      ))}
                    </tbody>
                  </table>
                </>
              )}
            </div>
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
