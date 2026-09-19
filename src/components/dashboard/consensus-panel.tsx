"use client";

import { useQuery } from "@tanstack/react-query";
import { useTerminalAuthenticated } from "@/components/terminal/terminal-auth-context";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { consensusQueries } from "@/lib/queries/consensus";

function getStatusBadge(status: string) {
  switch (status) {
    case "pending":
      return "bg-terminal-amber/10 text-terminal-amber";
    case "approved":
      return "bg-terminal-green/10 text-terminal-green";
    case "rejected":
      return "bg-terminal-red/10 text-terminal-red";
    default:
      return "bg-muted text-muted-foreground";
  }
}

export function ConsensusPanel() {
  const authed = useTerminalAuthenticated();
  const { data, isError, isPending } = useQuery(consensusQueries.list(authed));

  const proposals = data?.items ?? [];

  return (
    <section
      aria-label="Consensus proposals"
      className="flex flex-1 min-h-0 flex-col border border-border bg-card"
    >
      <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-2">
        <Tooltip>
          <TooltipTrigger
            render={
              <h2 className="text-xs font-bold tracking-wider text-foreground cursor-help">
                CONSENSUS
              </h2>
            }
          />
          <TooltipContent
            side="bottom"
            sideOffset={6}
            className="bg-card text-muted-foreground border border-border text-xs max-w-64"
          >
            Multi-agent voting proposals for trade entries, showing quorum
            progress and approval status
          </TooltipContent>
        </Tooltip>
        <span className="text-xs text-terminal-amber">
          {isPending
            ? "..."
            : `${proposals.filter((p) => p.status === "pending").length} pending`}
        </span>
      </div>
      <div className="flex flex-1 min-h-0 flex-col overflow-y-auto">
        {isPending ? (
          <div className="flex flex-col gap-2 px-4 py-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-10 animate-pulse bg-secondary" />
            ))}
          </div>
        ) : isError ? (
          <div className="px-4 py-3 text-xs text-terminal-red">
            CONSENSUS DATA UNAVAILABLE — retrying
          </div>
        ) : proposals.length === 0 ? (
          <div className="px-4 py-3 text-xs text-terminal-dim">
            NO PROPOSALS YET — run AI analysis to start the consensus pipeline
          </div>
        ) : (
          proposals.map((proposal) => {
            const progress =
              proposal.totalVoters > 0
                ? (proposal.votesFor / proposal.totalVoters) * 100
                : 0;
            return (
              <div
                key={proposal.id}
                className="flex flex-col gap-2 border-b border-border/50 px-4 py-3 hover:bg-secondary/30 transition-colors cursor-pointer"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-foreground">
                      {proposal.asset}
                    </span>
                    <span
                      className={`text-[10px] font-bold px-1.5 py-0.5 ${
                        proposal.direction === "LONG"
                          ? "bg-terminal-green/10 text-terminal-green"
                          : "bg-terminal-red/10 text-terminal-red"
                      }`}
                    >
                      {proposal.direction}
                    </span>
                    <span
                      className={`text-[10px] px-1.5 py-0.5 font-bold ${getStatusBadge(proposal.status)}`}
                    >
                      {proposal.status.toUpperCase()}
                    </span>
                  </div>
                  <span className="text-[10px] text-muted-foreground">
                    by {proposal.proposedBy}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <div className="h-1 flex-1 bg-secondary overflow-hidden">
                    <div
                      className={`h-full transition-all ${
                        proposal.status === "rejected"
                          ? "bg-terminal-red"
                          : "bg-terminal-green"
                      }`}
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                  <span className="text-[10px] text-muted-foreground shrink-0">
                    {proposal.votesFor}/{proposal.totalVoters}
                  </span>
                  <span className="text-[10px] text-terminal-amber shrink-0">
                    {(proposal.confidence * 100).toFixed(0)}% conf
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
