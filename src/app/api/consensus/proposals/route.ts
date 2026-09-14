import { desc, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { agents } from "@/db/schema/agent";
import { consensusProposals, consensusVotes } from "@/db/schema/consensus";
import { useLogger, withEvlog } from "@/lib/evlog";
import type {
  ConsensusProposal,
  ConsensusProposalsResponse,
} from "@/lib/queries/consensus";
import { agentRuntime } from "@/mastra/runtime/agent-runtime";

export const dynamic = "force-dynamic";

const LIMIT = 20;

/**
 * GET /api/consensus/proposals — recent consensus proposals for the
 * dashboard's ConsensusPanel, newest-first.
 *
 * Primary source: `consensus_proposals` joined with vote counts aggregated
 * from `consensus_votes` and the proposing agent's display name. When the
 * tables are empty or unreachable, ANALYSIS_PROPOSED / CONSENSUS_REACHED
 * events from the process-local runtime buffer are mapped into pseudo-
 * proposals so a fresh install still shows live pipeline activity — the
 * same fallback convention as the signals/trades activity routes.
 */
export const GET = withEvlog(async () => {
  const logger = useLogger();
  logger.set({ integration: "consensus" });

  let items: ConsensusProposal[] = [];
  let source: "db" | "events" = "db";

  try {
    const rows = await db
      .select({
        asset: consensusProposals.asset,
        confidence: consensusProposals.confidence,
        createdAt: consensusProposals.createdAt,
        deadline: consensusProposals.deadline,
        direction: consensusProposals.direction,
        id: consensusProposals.id,
        proposedBy: agents.name,
        proposedByAgentId: consensusProposals.proposedByAgentId,
        status: consensusProposals.status,
        totalVoters: sql<number>`(
          select count(*)::int from ${consensusVotes}
          where ${consensusVotes.proposalId} = ${consensusProposals.id}
        )`,
        votesAgainst: sql<number>`(
          select count(*)::int from ${consensusVotes}
          where ${consensusVotes.proposalId} = ${consensusProposals.id}
            and ${consensusVotes.vote} = 'against'
        )`,
        votesFor: sql<number>`(
          select count(*)::int from ${consensusVotes}
          where ${consensusVotes.proposalId} = ${consensusProposals.id}
            and ${consensusVotes.vote} = 'for'
        )`,
      })
      .from(consensusProposals)
      .leftJoin(agents, eq(consensusProposals.proposedByAgentId, agents.id))
      .orderBy(desc(consensusProposals.createdAt))
      .limit(LIMIT);

    items = rows.map((row) => ({
      asset: row.asset,
      confidence: Number(row.confidence),
      createdAt: row.createdAt.toISOString(),
      deadline: row.deadline.toISOString(),
      direction: row.direction,
      id: row.id,
      proposedBy: row.proposedBy ?? row.proposedByAgentId,
      status: row.status,
      totalVoters: Number(row.totalVoters),
      votesAgainst: Number(row.votesAgainst),
      votesFor: Number(row.votesFor),
    }));
  } catch (error) {
    logger.set({
      warning: `consensus db unavailable: ${
        error instanceof Error ? error.message : "unknown"
      }`,
    });
  }

  if (items.length === 0) {
    const pseudo: ConsensusProposal[] = [];
    const proposalEvents = new Map<
      string,
      {
        asset: string;
        confidence: number;
        createdAt: string;
        direction: "LONG" | "SHORT";
      }
    >();

    for (const event of agentRuntime.listRecentEvents(200)) {
      if (event.type === "ANALYSIS_PROPOSED") {
        proposalEvents.set(event.proposalId, {
          asset: event.asset,
          confidence: event.confidence,
          createdAt: event.createdAt,
          direction: event.direction,
        });
      }
      if (event.type === "CONSENSUS_REACHED") {
        const base = proposalEvents.get(event.proposalId);
        pseudo.push({
          asset: base?.asset ?? event.asset,
          confidence: base?.confidence ?? event.confidence,
          createdAt: base?.createdAt ?? event.createdAt,
          deadline: event.createdAt,
          direction: event.direction,
          id: event.proposalId,
          proposedBy: "orchestrator-agent",
          // Consensus threshold is 0.5 in the workflow; majority-for reads
          // as approved, otherwise still pending until risk gates it.
          status: event.votesFor > event.votesAgainst ? "approved" : "pending",
          totalVoters: event.votesFor + event.votesAgainst,
          votesAgainst: event.votesAgainst,
          votesFor: event.votesFor,
        });
      }
    }

    items = pseudo
      .sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      )
      .slice(0, LIMIT);
    if (items.length > 0) {
      source = "events";
    }
  }

  return Response.json({
    items,
    source,
  } satisfies ConsensusProposalsResponse);
});
