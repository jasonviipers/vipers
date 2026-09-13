import {
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { agents } from "./agent";
import { strategies } from "./strategies";
import { directionEnum } from "./trading";

export const proposalStatusEnum = pgEnum("proposal_status", [
  "pending",
  "approved",
  "rejected",
]);
export const voteEnum = pgEnum("vote", ["for", "against", "abstain"]);

export const consensusProposals = pgTable("consensus_proposals", {
  asset: text("asset").notNull(),
  confidence: numeric("confidence").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  deadline: timestamp("deadline").notNull(),
  direction: directionEnum("direction").notNull(),
  id: uuid("id").primaryKey().defaultRandom(),
  proposedByAgentId: text("proposed_by_agent_id")
    .notNull()
    .references(() => agents.id),
  status: proposalStatusEnum("status").notNull().default("pending"),
  strategyId: uuid("strategy_id")
    .notNull()
    .references(() => strategies.id),
});

// votesFor/votesAgainst/totalVoters become COUNT()s over this table instead
// of stored aggregates — and you get a real audit trail of who voted what
// and why, which is the actual product story for "consensus-driven execution."
export const consensusVotes = pgTable(
  "consensus_votes",
  {
    agentId: text("agent_id")
      .notNull()
      .references(() => agents.id),
    confidence: numeric("confidence").notNull(),
    id: uuid("id").primaryKey().defaultRandom(),
    proposalId: uuid("proposal_id")
      .notNull()
      .references(() => consensusProposals.id),
    reasoning: text("reasoning").notNull(),
    vote: voteEnum("vote").notNull(),
    votedAt: timestamp("voted_at").notNull().defaultNow(),
  },
  (t) => ({ uniq: unique().on(t.proposalId, t.agentId) }),
);
