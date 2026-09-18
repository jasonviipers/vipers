import "server-only";

import { createHash } from "node:crypto";

import { z } from "zod";

import { canonicalise } from "./canonical-json";

export type CapitalDirection = "LONG" | "SHORT";

export interface CapitalIntent {
  asset: string;
  confidence: number;
  direction: CapitalDirection;
  evidence: {
    signalId: string;
    technicalsFetchedAt: number;
    signalFetchedAt: number;
  };
  proposalId: string;
  reasoning: string;
  signalId: string;
  strategyVersion: string;
}

export interface NoTradeDecision {
  asset: string;
  confidence: number;
  decision: "NO_TRADE";
  evidence: {
    signalId: string;
    technicalsFetchedAt: number;
    signalFetchedAt: number;
  };
  proposalId: string;
  reason: string;
  signalId: string;
  strategyVersion: string;
}

const capitalIntentSchema = z.object({
  asset: z.string().min(1),
  confidence: z.number().min(0).max(1),
  direction: z.enum(["LONG", "SHORT"]),
  evidence: z.object({
    signalId: z.string().min(1),
    signalFetchedAt: z.number().finite(),
    technicalsFetchedAt: z.number().finite(),
  }),
  proposalId: z.string().min(1),
  reasoning: z.string().min(1),
  signalId: z.string().min(1),
  strategyVersion: z.string().min(1),
});

const noTradeDecisionSchema = z.object({
  asset: z.string().min(1),
  confidence: z.number().min(0).max(1),
  decision: z.literal("NO_TRADE"),
  evidence: z.object({
    signalId: z.string().min(1),
    signalFetchedAt: z.number().finite(),
    technicalsFetchedAt: z.number().finite(),
  }),
  proposalId: z.string().min(1),
  reason: z.string().min(1),
  signalId: z.string().min(1),
  strategyVersion: z.string().min(1),
});

export function validateCapitalDecision(
  decision: unknown,
): CapitalIntent | NoTradeDecision {
  if (
    typeof decision === "object" &&
    decision !== null &&
    "decision" in decision &&
    decision.decision === "NO_TRADE"
  ) {
    return noTradeDecisionSchema.parse(decision);
  }
  return capitalIntentSchema.parse(decision);
}

/**
 * Hash only the proposal and evidence identity, before risk/order outcome.
 * This is the approval boundary: changing intent or evidence requires a new
 * decision, while the later risk and broker outcome remain separately hashed
 * in the immutable decision snapshot.
 */
export function hashCapitalIntent(
  intent: CapitalIntent | NoTradeDecision,
): string {
  return createHash("sha256").update(canonicalise(intent)).digest("hex");
}

export function createCapitalIntent(input: {
  asset: string;
  confidence: number;
  direction: CapitalDirection;
  proposalId: string;
  reasoning: string;
  signalId: string;
  signalFetchedAt: number;
  strategyVersion?: string;
  technicalsFetchedAt: number;
}): CapitalIntent {
  return {
    asset: input.asset,
    confidence: input.confidence,
    direction: input.direction,
    evidence: {
      signalId: input.signalId,
      signalFetchedAt: input.signalFetchedAt,
      technicalsFetchedAt: input.technicalsFetchedAt,
    },
    proposalId: input.proposalId,
    reasoning: input.reasoning,
    signalId: input.signalId,
    strategyVersion: input.strategyVersion ?? "consensus-v1",
  };
}

export function createNoTradeDecision(input: {
  asset: string;
  confidence: number;
  proposalId: string;
  reason: string;
  signalId: string;
  signalFetchedAt: number;
  strategyVersion?: string;
  technicalsFetchedAt: number;
}): NoTradeDecision {
  return {
    asset: input.asset,
    confidence: input.confidence,
    decision: "NO_TRADE",
    evidence: {
      signalId: input.signalId,
      signalFetchedAt: input.signalFetchedAt,
      technicalsFetchedAt: input.technicalsFetchedAt,
    },
    proposalId: input.proposalId,
    reason: input.reason,
    signalId: input.signalId,
    strategyVersion: input.strategyVersion ?? "consensus-v1",
  };
}
