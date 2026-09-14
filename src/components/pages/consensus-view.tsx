"use client";

import { useQuery } from "@tanstack/react-query";
import { CheckCircle, Clock, Shield, XCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { agentsDbQueries } from "@/lib/queries/agents-db";
import {
  type ConsensusProposal,
  consensusQueries,
} from "@/lib/queries/consensus";

// -- helpers ----------------------------------------------------------------

function getStatusConfig(status: ConsensusProposal["status"]) {
  switch (status) {
    case "pending":
      return {
        bg: "bg-terminal-amber/10",
        color: "text-terminal-amber",
        icon: Clock,
        label: "PENDING",
      };
    case "approved":
      return {
        bg: "bg-terminal-green/10",
        color: "text-terminal-green",
        icon: CheckCircle,
        label: "APPROVED",
      };
    case "rejected":
      return {
        bg: "bg-terminal-red/10",
        color: "text-terminal-red",
        icon: XCircle,
        label: "REJECTED",
      };
  }
}

function formatTimeAgo(date: Date, nowMs: number) {
  const seconds = Math.max(0, Math.floor((nowMs - date.getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}

/** Countdown for the voting deadline; proposals are short-lived. */
function formatTimeUntil(date: Date, nowMs: number) {
  const seconds = Math.floor((date.getTime() - nowMs) / 1000);
  if (seconds <= 0) return "closed";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m left`;
  return `${Math.floor(minutes / 60)}h left`;
}

function confidenceColor(confidence: number) {
  if (confidence >= 0.7) return "text-terminal-green";
  if (confidence >= 0.4) return "text-terminal-amber";
  return "text-terminal-red";
}

// -- Proposal card ----------------------------------------------------------

function ProposalCard({
  proposal,
  now,
}: {
  proposal: ConsensusProposal;
  now: number;
}) {
  const statusConfig = getStatusConfig(proposal.status);
  const StatusIcon = statusConfig.icon;

  // Guards keep the bar NaN-free when the events fallback yields zero votes.
  const voters = Math.max(proposal.totalVoters, 1);
  const forPct = (proposal.votesFor / voters) * 100;
  const againstPct = (proposal.votesAgainst / voters) * 100;
  const remainingVotes = Math.max(
    0,
    proposal.totalVoters - proposal.votesFor - proposal.votesAgainst,
  );
  const remainingPct = Math.max(0, 100 - forPct - againstPct);

  const deadlineMs = new Date(proposal.deadline).getTime();
  const deadlineClosed = deadlineMs <= now;

  return (
    <div className="flex flex-col gap-4 border-b border-border/50 bg-card p-5 transition-colors hover:bg-secondary/20">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-lg font-bold text-foreground">
            {proposal.asset}
          </span>
          <span
            className={`px-2 py-0.5 text-xs font-bold ${
              proposal.direction === "LONG"
                ? "bg-terminal-green/10 text-terminal-green"
                : "bg-terminal-red/10 text-terminal-red"
            }`}
          >
            {proposal.direction}
          </span>
          <span
            className={`flex items-center gap-1 px-2 py-0.5 text-xs font-bold ${statusConfig.bg} ${statusConfig.color}`}
          >
            <StatusIcon className="h-3 w-3" />
            {statusConfig.label}
          </span>
        </div>
        <div className="flex flex-col items-end gap-0.5">
          <span className="text-[10px] text-muted-foreground">
            by {proposal.proposedBy}
          </span>
          <time
            dateTime={proposal.createdAt}
            className="text-[10px] text-terminal-dim"
            suppressHydrationWarning
          >
            {formatTimeAgo(new Date(proposal.createdAt), now)}
          </time>
        </div>
      </div>

      {/* Vote progress */}
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-1 text-xs">
          <span className="font-bold text-terminal-green">
            FOR {proposal.votesFor}
          </span>
          <span className="text-muted-foreground">
            {remainingVotes} remaining
          </span>
          <span className="font-bold text-terminal-red">
            AGAINST {proposal.votesAgainst}
          </span>
        </div>
        <div
          className="flex h-2 w-full overflow-hidden bg-secondary"
          role="progressbar"
          aria-label={`Votes for ${proposal.asset} proposal: ${proposal.votesFor} for, ${proposal.votesAgainst} against, ${remainingVotes} remaining`}
          aria-valuemin={0}
          aria-valuemax={proposal.totalVoters}
          aria-valuenow={proposal.votesFor}
        >
          <div
            className="bg-terminal-green transition-all"
            style={{ width: `${forPct}%` }}
          />
          <div
            className="bg-terminal-dim transition-all"
            style={{ width: `${remainingPct}%` }}
          />
          <div
            className="bg-terminal-red transition-all"
            style={{ width: `${againstPct}%` }}
          />
        </div>
      </div>

      {/* Metrics */}
      <div className="flex items-center gap-6 text-xs">
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] text-muted-foreground">CONFIDENCE</span>
          <span className={`font-bold ${confidenceColor(proposal.confidence)}`}>
            {(proposal.confidence * 100).toFixed(0)}%
          </span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] text-muted-foreground">QUORUM</span>
          <span className="font-bold text-foreground">
            {proposal.votesFor + proposal.votesAgainst}/{proposal.totalVoters}
          </span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] text-muted-foreground">DEADLINE</span>
          <span
            className={`font-bold ${deadlineClosed ? "text-terminal-red" : "text-terminal-dim"}`}
            suppressHydrationWarning
          >
            {formatTimeUntil(new Date(proposal.deadline), now)}
          </span>
        </div>
      </div>
    </div>
  );
}

// -- Main view --------------------------------------------------------------

export function ConsensusView() {
  const { data, isError, isPending } = useQuery(consensusQueries.list());
  const { data: fleet } = useQuery(agentsDbQueries.fleet());

  // Clock tick keeps relative timestamps/deadlines fresh between fetches.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);

  const proposals = data?.items ?? [];

  const counts = useMemo(
    () =>
      proposals.reduce(
        (acc, p) => {
          acc[p.status] += 1;
          return acc;
        },
        { pending: 0, approved: 0, rejected: 0 } as Record<
          ConsensusProposal["status"],
          number
        >,
      ),
    [proposals],
  );

  // Voting pool: analysis/risk/coordination teams participate in consensus.
  const voterCount = useMemo(
    () =>
      (fleet?.items ?? []).filter((agent) =>
        ["ANALYSIS", "RISK", "COORDINATION"].includes(agent.team),
      ).length,
    [fleet],
  );

  return (
    <div className="flex h-full flex-col">
      {/* Stats bar */}
      <div className="flex flex-wrap items-center gap-3 border-b border-border bg-card px-4 py-3 sm:gap-6">
        <div className="flex items-center gap-2">
          <Shield className="h-4 w-4 text-terminal-amber" />
          <h1 className="text-xs font-bold tracking-wider text-foreground">
            CONSENSUS ENGINE
          </h1>
          <span className="text-[10px] text-muted-foreground">
            {isPending
              ? "loading..."
              : isError
                ? "offline"
                : `${proposals.length} proposals`}
          </span>
          <span
            className={`text-[10px] font-bold ${
              data?.source === "events"
                ? "text-terminal-amber"
                : "text-muted-foreground"
            }`}
          >
            {data?.source === "events" ? "RUNTIME EVENTS (NO DB HISTORY)" : ""}
          </span>
        </div>
        <div className="flex items-center gap-4 text-xs">
          <span className="text-terminal-amber">{counts.pending} PENDING</span>
          <span className="text-terminal-green">
            {counts.approved} APPROVED
          </span>
          <span className="text-terminal-red">{counts.rejected} REJECTED</span>
          <span className="hidden text-muted-foreground sm:inline">
            {voterCount} VOTERS
          </span>
        </div>
      </div>

      {/* Proposal feed */}
      <ScrollArea className="flex-1">
        {isPending ? (
          <div className="flex flex-col gap-px p-px">
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-40 animate-pulse bg-secondary border-b border-border/50"
              />
            ))}
          </div>
        ) : isError ? (
          <div className="p-4 text-xs text-terminal-red">
            CONSENSUS DATA UNAVAILABLE — retrying
          </div>
        ) : proposals.length === 0 ? (
          <div className="p-4 text-xs text-terminal-dim">
            NO PROPOSALS YET — run AI analysis to start the consensus pipeline
          </div>
        ) : (
          <div className="flex flex-col gap-px p-px">
            {proposals.map((proposal) => (
              <ProposalCard key={proposal.id} proposal={proposal} now={now} />
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
