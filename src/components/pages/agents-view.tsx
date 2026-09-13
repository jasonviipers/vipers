"use client";

import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  Cpu,
  Filter,
  Network,
  ShieldAlert,
  TrendingUp,
  X,
  Zap,
} from "lucide-react";
import { useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { type AgentFleetEntry, agentsDbQueries } from "@/lib/queries/agents-db";

const TEAMS = [
  "ALL",
  "SENTIMENT",
  "ANALYSIS",
  "EXECUTION",
  "RISK",
  "COORDINATION",
] as const;

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

function getTeamIcon(team: string) {
  switch (team) {
    case "SENTIMENT":
      return <Zap className="h-4 w-4" />;
    case "ANALYSIS":
      return <Cpu className="h-4 w-4" />;
    case "EXECUTION":
      return <TrendingUp className="h-4 w-4" />;
    case "RISK":
      return <ShieldAlert className="h-4 w-4" />;
    case "COORDINATION":
      return <Network className="h-4 w-4" />;
    default:
      return <Activity className="h-4 w-4" />;
  }
}

function MiniSparkline({ data, color }: { data: number[]; color: string }) {
  // No equity history yet (fresh install / DB unreachable): render a flat
  // dashed baseline instead of a degenerate polyline.
  if (data.length < 2) {
    return (
      <svg width={80} height={24} role="img" aria-label="No equity history">
        <line
          x1="0"
          y1="12"
          x2="80"
          y2="12"
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
  const width = 80;
  const height = 24;
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
      role="img"
      aria-label={`Sparkline trending ${data[data.length - 1] >= data[0] ? "up" : "down"}`}
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

type PendingProposal = {
  id: string;
  asset: string;
  direction: "LONG" | "SHORT";
  quantity: number;
  entryPrice: number | null;
  reasoning: string;
  confidence: number;
  agentName: string;
};

type Agent = AgentFleetEntry;

function AgentCard({ agent }: { agent: Agent }) {
  return (
    <article className="flex flex-col gap-3 border border-border bg-card p-3 hover:bg-secondary/20 transition-colors cursor-pointer sm:p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div
            className={`h-2 w-2 rounded-full ${getStatusColor(agent.status)}`}
          />
          <span className="text-sm font-bold text-foreground">
            {agent.codename ?? agent.id}
          </span>
        </div>
        <span className={`text-xs ${getTeamColor(agent.team)}`}>
          {agent.team}
        </span>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
            ROLE
          </span>
          <span className="text-xs text-foreground">
            {agent.role.replace(/_/g, " ")}
          </span>
        </div>
        <div className="flex flex-col gap-0.5 items-end">
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
            STATUS
          </span>
          <span
            className={`text-xs uppercase font-bold ${
              agent.status === "online"
                ? "text-terminal-green"
                : agent.status === "busy"
                  ? "text-terminal-amber"
                  : agent.status === "error"
                    ? "text-terminal-red"
                    : "text-terminal-dim"
            }`}
          >
            {agent.status}
          </span>
        </div>
      </div>

      <div className="flex items-end justify-between border-t border-border pt-3">
        <div className="grid grid-cols-3 gap-3">
          <div className="flex flex-col">
            <span className="text-[10px] text-muted-foreground">P&L</span>
            <span
              className={`text-xs font-bold ${agent.stats.pnl >= 0 ? "text-terminal-green" : "text-terminal-red"}`}
            >
              {agent.stats.pnl >= 0 ? "+" : ""}$
              {(agent.stats.pnl / 1000).toFixed(1)}k
            </span>
          </div>
          <div className="flex flex-col">
            <span className="text-[10px] text-muted-foreground">ROI</span>
            <span
              className={`text-xs font-bold ${agent.stats.roi >= 0 ? "text-terminal-green" : "text-terminal-red"}`}
            >
              {agent.stats.roi >= 0 ? "+" : ""}
              {agent.stats.roi.toFixed(1)}%
            </span>
          </div>
          <div className="flex flex-col">
            <span className="text-[10px] text-muted-foreground">WIN</span>
            <span className="text-xs font-bold text-foreground">
              {agent.stats.winRate.toFixed(1)}%
            </span>
          </div>
        </div>
        <MiniSparkline
          data={agent.stats.equityData}
          color={agent.stats.pnl >= 0 ? "#00d4aa" : "#ff4444"}
        />
      </div>

      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span>SHARPE {agent.stats.sharpe.toFixed(2)}</span>
        <span>MDD {agent.stats.maxDrawdown.toFixed(1)}%</span>
        <span>TRADES {agent.stats.trades}</span>
      </div>
    </article>
  );
}

function TeamSummary({ team, agents }: { team: string; agents: Agent[] }) {
  const online = agents.filter(
    (a) => a.status === "online" || a.status === "busy",
  ).length;
  const totalPnl = agents.reduce((s, a) => s + a.stats.pnl, 0);

  return (
    <div className="flex items-center gap-3 border border-border bg-card px-4 py-3">
      <div className={getTeamColor(team)}>{getTeamIcon(team)}</div>
      <div className="flex flex-col">
        <span className={`text-xs font-bold ${getTeamColor(team)}`}>
          {team}
        </span>
        <span className="text-[10px] text-muted-foreground">
          {online}/{agents.length} online
        </span>
      </div>
      <div className="ml-auto text-right">
        <span
          className={`text-xs font-bold ${totalPnl >= 0 ? "text-terminal-green" : "text-terminal-red"}`}
        >
          {totalPnl >= 0 ? "+" : ""}${(totalPnl / 1000).toFixed(1)}k
        </span>
      </div>
    </div>
  );
}

export function AgentsView() {
  const [selectedTeam, setSelectedTeam] = useState<string>("ALL");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [proposals, setProposals] = useState<PendingProposal[]>([]);

  const fleetQuery = useQuery(agentsDbQueries.fleet());
  const allAgents: Agent[] = fleetQuery.data?.items ?? [];
  const teams = [...new Set(allAgents.map((a) => a.team))];
  const filteredAgents =
    selectedTeam === "ALL"
      ? allAgents
      : allAgents.filter((a) => a.team === selectedTeam);

  return (
    <section
      className="flex h-full flex-col md:flex-row"
      aria-label="Agents management"
    >
      {/* Mobile filter bar - horizontal scrollable pills */}
      <div className="flex items-center gap-2 border-b border-border bg-card px-3 py-2 md:hidden overflow-x-auto">
        <button
          type="button"
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="flex shrink-0 items-center gap-1.5 px-2 py-1 text-[10px] font-bold tracking-wider text-muted-foreground border border-border hover:text-foreground transition-colors"
          aria-expanded={sidebarOpen}
          aria-controls="team-sidebar"
        >
          {sidebarOpen ? (
            <X className="h-3 w-3" />
          ) : (
            <Filter className="h-3 w-3" />
          )}
          TEAMS
        </button>
        <div className="flex items-center gap-1 overflow-x-auto">
          {TEAMS.map((team) => (
            <button
              type="button"
              key={team}
              onClick={() => setSelectedTeam(team)}
              className={`shrink-0 px-2.5 py-1 text-[10px] tracking-wider transition-colors ${
                selectedTeam === team
                  ? "bg-secondary text-terminal-green"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {team}
            </button>
          ))}
        </div>
        <span className="ml-auto shrink-0 text-[10px] text-terminal-dim">
          {filteredAgents.length}
        </span>
      </div>

      {/* Mobile team overview panel (toggle) */}
      {sidebarOpen && (
        <div className="flex flex-col gap-px border-b border-border bg-card p-2 md:hidden">
          {teams.map((team) => (
            <TeamSummary
              key={team}
              team={team}
              agents={allAgents.filter((a) => a.team === team)}
            />
          ))}
        </div>
      )}

      {/* Left sidebar - Team filter (desktop) */}
      <aside
        id="team-sidebar"
        className="hidden w-64 shrink-0 border-r border-border bg-card md:flex md:flex-col"
        aria-label="Team filter"
      >
        <div className="border-b border-border px-4 py-2">
          <span className="text-xs font-bold tracking-wider text-foreground">
            TEAM FILTER
          </span>
        </div>
        <div className="flex flex-col gap-px p-2">
          {TEAMS.map((team) => (
            <button
              type="button"
              key={team}
              onClick={() => setSelectedTeam(team)}
              className={`flex items-center gap-2 px-3 py-2 text-xs text-left transition-colors ${
                selectedTeam === team
                  ? "bg-secondary text-terminal-green"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
              }`}
            >
              {team === "ALL" ? (
                <Activity className="h-3 w-3" />
              ) : (
                getTeamIcon(team)
              )}
              <span className="tracking-wider">{team}</span>
              <span className="ml-auto text-terminal-dim">
                {team === "ALL"
                  ? allAgents.length
                  : allAgents.filter((a) => a.team === team).length}
              </span>
            </button>
          ))}
        </div>
        <div className="mt-auto flex flex-col gap-px p-2 border-t border-border">
          <span className="text-xs font-bold tracking-wider text-foreground px-3 py-1">
            TEAM OVERVIEW
          </span>
          {teams.map((team) => (
            <TeamSummary
              key={team}
              team={team}
              agents={allAgents.filter((a) => a.team === team)}
            />
          ))}
        </div>
      </aside>

      {/* Main content - Agent cards */}
      <div className="flex-1 flex flex-col min-w-0">
        <ScrollArea className="flex-1">
          {proposals.length > 0 && (
            <div className="border-b border-border bg-card p-3 sm:p-4">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <h2 className="text-xs font-bold tracking-wider text-foreground">
                    PAPER TRADE PROPOSALS
                  </h2>
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    AI-generated recommendations require manual approval.
                  </p>
                </div>
                <span className="text-[10px] text-terminal-amber">
                  {proposals.length} PENDING
                </span>
              </div>
              <div className="flex flex-col gap-2">
                {proposals.map((proposal) => (
                  <div
                    key={proposal.id}
                    className="border border-border/80 p-3"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-foreground">
                          {proposal.asset}
                        </span>
                        <span
                          className={
                            proposal.direction === "LONG"
                              ? "text-terminal-green"
                              : "text-terminal-red"
                          }
                        >
                          {proposal.direction}
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          QTY {proposal.quantity}
                        </span>
                      </div>
                      <span className="text-[10px] text-terminal-cyan">
                        CONF {(proposal.confidence * 100).toFixed(0)}%
                      </span>
                    </div>
                    <p className="mt-2 max-w-3xl text-xs leading-relaxed text-muted-foreground">
                      {proposal.reasoning}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="grid grid-cols-1 gap-px p-px sm:grid-cols-2 xl:grid-cols-3">
            {filteredAgents.map((agent) => (
              <AgentCard key={agent.id} agent={agent} />
            ))}
          </div>
        </ScrollArea>
      </div>
    </section>
  );
}
