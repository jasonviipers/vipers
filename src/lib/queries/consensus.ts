import { queryOptions } from "@tanstack/react-query";

export interface ConsensusProposal {
  id: string;
  asset: string;
  direction: "LONG" | "SHORT";
  status: "pending" | "approved" | "rejected";
  /** Display name of the proposing agent. */
  proposedBy: string;
  /** 0-1. */
  confidence: number;
  votesFor: number;
  votesAgainst: number;
  totalVoters: number;
  createdAt: string;
  deadline: string;
}

export interface ConsensusProposalsResponse {
  items: ConsensusProposal[];
  /** "db" = consensus tables, "events" = runtime event-buffer fallback. */
  source: "db" | "events";
}

export const consensusKeys = {
  all: ["consensus"] as const,
  list: () => [...consensusKeys.all, "proposals"] as const,
};

async function fetchJson<T>(input: string): Promise<T> {
  const response = await fetch(input);
  if (!response.ok) {
    throw new Error(`API ${response.status}: ${response.statusText}`);
  }
  return (await response.json()) as T;
}

export const consensusQueries = {
  /**
   * 15s poll: proposals move through voting quickly, and the runtime
   * event fallback below only covers the current process lifetime.
   */
  list: () =>
    queryOptions({
      queryKey: consensusKeys.list(),
      queryFn: () =>
        fetchJson<ConsensusProposalsResponse>("/api/consensus/proposals"),
      refetchInterval: 15_000,
      staleTime: 15_000,
    }),
};
