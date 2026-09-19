"use client";

import { useQuery } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import { useMemo, useState } from "react";
import { useTerminalAuthenticated } from "@/components/terminal/terminal-auth-context";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useColorScheme } from "@/context/color-scheme-context";
import { fmtDollar } from "@/lib/format";
import { agentsDbQueries } from "@/lib/queries/agents-db";

type SortKey = "pnl" | "roi" | "winRate" | "trades" | "name";

function getStatusColor(status: string) {
  switch (status) {
    case "online":
      return "bg-terminal-green";
    case "busy":
      return "bg-terminal-amber";
    case "error":
      return "bg-terminal-red";
    case "offline":
      return "bg-terminal-dim";
    default:
      return "bg-terminal-dim";
  }
}

function getTeamColor(team: string) {
  switch (team) {
    case "SENTIMENT":
      return "text-terminal-cyan";
    case "ANALYSIS":
      return "text-terminal-amber";
    case "EXECUTION":
      return "text-terminal-green";
    case "RISK":
      return "text-terminal-red";
    case "COORDINATION":
      return "text-terminal-gold";
    default:
      return "text-muted-foreground";
  }
}

function MiniSparkline({ data, color }: { data: number[]; color: string }) {
  // No equity history yet (fresh install / DB unreachable): flat dashed baseline.
  if (data.length < 2) {
    return (
      <svg
        width={60}
        height={16}
        className="shrink-0"
        role="img"
        aria-label="No performance history"
      >
        <line
          x1="0"
          y1="8"
          x2="60"
          y2="8"
          stroke={color}
          strokeWidth="1.5"
          strokeDasharray="3 3"
          opacity="0.4"
        />
      </svg>
    );
  }
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const width = 60;
  const height = 16;
  const points = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * width;
      const y = height - ((v - min) / range) * height;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <svg
      width={width}
      height={height}
      className="shrink-0"
      role="img"
      aria-label="Agent performance trend"
    >
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function AgentGrid() {
  const { definition } = useColorScheme();
  const sparkGreen = definition.colors.green;
  const sparkRed = definition.colors.red;
  const authed = useTerminalAuthenticated();
  const { data, isError, isPending } = useQuery(agentsDbQueries.fleet(authed));
  const [sortKey, setSortKey] = useState<SortKey>("pnl");
  const [sortDesc, setSortDesc] = useState(true);

  const agents = useMemo(() => data?.items ?? [], [data]);

  const sortedAgents = useMemo(() => {
    const sorted = [...agents].sort((a, b) => {
      if (sortKey === "name") {
        return a.id.localeCompare(b.id);
      }
      return a.stats[sortKey] - b.stats[sortKey];
    });
    return sortDesc ? sorted.reverse() : sorted;
  }, [agents, sortKey, sortDesc]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDesc((d) => !d);
    } else {
      setSortKey(key);
      setSortDesc(key !== "name");
    }
  }

  return (
    <section
      aria-label="Agent swarm grid"
      className="flex flex-col border border-border bg-card"
    >
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <Tooltip>
          <TooltipTrigger
            render={
              <h2 className="text-xs font-bold tracking-wider text-foreground cursor-help">
                AGENT SWARM
              </h2>
            }
          />
          <TooltipContent
            side="bottom"
            sideOffset={6}
            className="bg-card text-muted-foreground border border-border text-xs max-w-64"
          >
            Overview of all active trading agents, their P&L, win rate, and
            real-time performance trends
          </TooltipContent>
        </Tooltip>
        <span className="text-xs text-muted-foreground">
          {isPending
            ? "loading..."
            : isError
              ? "offline"
              : `${agents.length} agents`}
        </span>
      </div>
      <div className="overflow-x-auto">
        <div className="min-w-120">
          <div className="grid grid-cols-[1fr_60px_60px_60px_50px_60px] gap-px px-4 py-1.5 text-xs text-muted-foreground border-b border-border">
            {(
              [
                ["AGENT", "name", "text-left"],
                ["P&L", "pnl", "text-right"],
                ["ROI%", "roi", "text-right"],
                ["WIN%", "winRate", "text-right"],
                ["TRDS", "trades", "text-right"],
              ] as const
            ).map(([label, key, align]) => (
              <button
                type="button"
                key={key}
                onClick={() => toggleSort(key)}
                className={`flex items-center gap-0.5 hover:text-foreground transition-colors ${align} ${
                  sortKey === key ? "text-terminal-green" : ""
                }`}
              >
                {label}
                {sortKey === key && (
                  <ChevronDown
                    className={`h-2.5 w-2.5 transition-transform ${sortDesc ? "" : "rotate-180"}`}
                  />
                )}
              </button>
            ))}
            <span className="text-right">TREND</span>
          </div>
          <ScrollArea className="h-64">
            {isPending ? (
              <div className="flex flex-col gap-2 p-4">
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="h-5 animate-pulse bg-secondary" />
                ))}
              </div>
            ) : isError ? (
              <div className="p-4 text-xs text-terminal-red">
                AGENT DATA UNAVAILABLE — retrying
              </div>
            ) : sortedAgents.length === 0 ? (
              <div className="p-4 text-xs text-terminal-dim">
                NO AGENTS CONFIGURED
              </div>
            ) : (
              sortedAgents.map((agent) => (
                <div
                  key={agent.id}
                  className="grid grid-cols-[1fr_60px_60px_60px_50px_60px] gap-px px-4 py-1.5 text-xs border-b border-border/50 hover:bg-secondary/30 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <div
                      className={`h-1.5 w-1.5 rounded-full ${getStatusColor(agent.status)}`}
                    />
                    <span className="font-bold text-foreground truncate">
                      {agent.codename ?? agent.id}
                    </span>
                    <span className={`text-[10px] ${getTeamColor(agent.team)}`}>
                      {agent.team.slice(0, 4)}
                    </span>
                  </div>
                  <span
                    className={`text-right ${agent.stats.pnl >= 0 ? "text-terminal-green" : "text-terminal-red"}`}
                  >
                    {agent.stats.pnl >= 0 ? "+" : ""}
                    {fmtDollar(Math.abs(agent.stats.pnl) / 1000)}k
                  </span>
                  <span
                    className={`text-right ${agent.stats.roi >= 0 ? "text-terminal-green" : "text-terminal-red"}`}
                  >
                    {agent.stats.roi >= 0 ? "+" : ""}
                    {agent.stats.roi.toFixed(1)}%
                  </span>
                  <span className="text-right text-foreground">
                    {agent.stats.winRate.toFixed(1)}%
                  </span>
                  <span className="text-right text-muted-foreground">
                    {agent.stats.trades}
                  </span>
                  <div className="flex justify-end">
                    <MiniSparkline
                      data={agent.stats.equityData}
                      color={agent.stats.pnl >= 0 ? sparkGreen : sparkRed}
                    />
                  </div>
                </div>
              ))
            )}
          </ScrollArea>
        </div>
      </div>
    </section>
  );
}
