import { createHash } from "node:crypto";

import { canonicalise } from "@/ai/capital-engine/canonical-json";
import {
  type RiskVerdict,
  riskVerdictFromEvaluation,
} from "@/ai/capital-engine/risk-verdict";
import type { MarketSignals } from "@/ai/tools/market-signals-tool";
import type { TechnicalSnapshot } from "@/ai/tools/technical-analysis-tool";
import { db } from "@/db";
import { decisionLedger, decisionSnapshots } from "@/db/schema/audit";
import { log } from "@/lib/evlog";

/**
 * Immutable decision snapshot: the durable, content-addressed record of one
 * consensus decision.
 *
 * Every input the decision was based on (signal, technicals, proposal,
 * consensus vote) and every outcome (risk decision, order result, or block
 * reason) is captured in one JSON blob, and the exact bytes of that blob are
 * hashed (sha256) into `contentHash`. Re-hashing a row later and comparing
 * to `contentHash` detects any drift between what the system decided on and
 * what is stored today — the replay surface the in-process event bus does
 * not provide (see AI_CAPITAL_ARCHITECTURE_RESEARCH.md §4.E).
 */

export interface DecisionInputs {
  consensus: {
    confidence: number;
    direction: "LONG" | "SHORT" | "ABSTAIN";
    quorum: number;
    votesAgainst: number;
    votesFor: number;
  };
  proposal: {
    agentId: string;
    asset: string;
    confidence: number;
    direction: "LONG" | "SHORT" | "ABSTAIN";
    proposalId: string;
    reasoning: string;
    signalId: string;
  };
  signal: {
    asset: string;
    confidence: number;
    fetchedAt: number;
    highlights: string[];
    sentimentBreakdown: { redditScore: number; rssScore: number };
    sentimentSocialVolume: number;
    sentimentSources: { reddit: number; rss: number };
    signalId: string;
  };
  technicals: {
    fetchedAt: number;
    patterns: string[];
    regime: string;
    rsi: number;
    stale?: boolean;
    trend: string;
  };
}

export interface DecisionMetadata {
  correlationId: string;
  dataTimestamps: number[];
  model?: string;
  pluginVersion: string;
  policyVersion: string;
  provider?: string;
  settingsHash?: string;
}

export interface DecisionOutcome {
  blocked?: boolean;
  order?: {
    asset: string;
    detail?: string;
    direction: "LONG" | "SHORT";
    orderId: string;
    quantity: number;
    status: string;
  } | null;
  risk: {
    approved: boolean;
    positionSizePct: number;
    reason: string;
    verdict?: RiskVerdict;
  };
}

export interface DecisionSnapshot {
  asset: string;
  inputs: DecisionInputs;
  intentHash?: string;
  metadata?: DecisionMetadata;
  outcome: DecisionOutcome;
  proposalId: string;
  signalId: string;
}

export function snapshotInputsForSignal(
  signal: import("@/ai/events/contracts").SignalCreated,
  marketSignals: MarketSignals,
): DecisionInputs["signal"] {
  return {
    asset: signal.asset,
    confidence: signal.confidence,
    fetchedAt: marketSignals.fetchedAt,
    highlights: marketSignals.highlights,
    sentimentBreakdown: marketSignals.breakdown,
    sentimentSocialVolume: marketSignals.socialVolume,
    sentimentSources: marketSignals.sources,
    signalId: signal.signalId,
  };
}

export function hashDecision(snapshot: DecisionSnapshot): string {
  return createHash("sha256")
    .update(
      canonicalise({
        asset: snapshot.asset,
        inputs: snapshot.inputs,
        metadata: snapshot.metadata,
        outcome: snapshot.outcome,
        proposalId: snapshot.proposalId,
      }),
    )
    .digest("hex");
}

/** Re-verify a stored row: recompute the hash and confirm it still matches. */
export function verifySnapshotHash(
  storedHash: string,
  snapshot: DecisionSnapshot,
): boolean {
  return hashDecision(snapshot) === storedHash;
}

/**
 * Replay the durable decision payload without calling an LLM or broker.
 * Replay is intentionally an integrity check and reconstruction surface, not
 * a second authorization path: a caller must still run the live risk gate
 * before any new execution request.
 */
export function replayDecisionSnapshot(input: {
  contentHash: string;
  snapshot: DecisionSnapshot;
}): {
  contentHash: string;
  intentHash?: string;
  riskVerdict: RiskVerdict;
  verified: boolean;
} {
  const riskVerdict =
    input.snapshot.outcome.risk.verdict ??
    riskVerdictFromEvaluation({
      approved: input.snapshot.outcome.risk.approved,
      reason: input.snapshot.outcome.risk.reason,
    });
  return {
    contentHash: input.contentHash,
    intentHash: input.snapshot.intentHash,
    riskVerdict,
    verified: verifySnapshotHash(input.contentHash, input.snapshot),
  };
}

/**
 * Persist one immutable snapshot per proposal. Write-once: a duplicate
 * proposalId is ignored (the existing row is the record). A persistence
 * failure is logged and swallowed — it must never take down the workflow
 * or fabricate an outcome, only leave the decision without its durable
 * audit copy. The hash is computed over inputs + outcome + identity so a
 * row cannot be subtly edited without breaking the hash.
 */
export async function persistDecisionSnapshot(
  snapshot: DecisionSnapshot,
): Promise<void> {
  const metadata: DecisionMetadata = snapshot.metadata ?? {
    correlationId: snapshot.proposalId,
    dataTimestamps: [
      snapshot.inputs.signal.fetchedAt,
      snapshot.inputs.technicals.fetchedAt,
    ],
    pluginVersion: "consensus-v1",
    policyVersion: "risk-v1",
  };
  const enrichedSnapshot: DecisionSnapshot = {
    ...snapshot,
    metadata,
    outcome: {
      ...snapshot.outcome,
      risk: {
        ...snapshot.outcome.risk,
        verdict:
          snapshot.outcome.risk.verdict ??
          riskVerdictFromEvaluation({
            approved: snapshot.outcome.risk.approved,
            reason: snapshot.outcome.risk.reason,
          }),
      },
    },
  };
  const contentHash = hashDecision(enrichedSnapshot);
  try {
    const intentHash = enrichedSnapshot.intentHash ?? contentHash;
    await db.transaction(async (tx) => {
      await tx
        .insert(decisionSnapshots)
        .values({
          asset: snapshot.asset,
          contentHash,
          inputSnapshot: enrichedSnapshot.inputs,
          intentHash,
          metadata,
          outcome: enrichedSnapshot.outcome,
          proposalId: snapshot.proposalId,
          signalId: snapshot.signalId,
        })
        .onConflictDoNothing({ target: decisionSnapshots.proposalId });
      await tx
        .insert(decisionLedger)
        .values({
          contentHash,
          eventType: snapshot.outcome.risk.approved
            ? "RISK_APPROVED"
            : snapshot.outcome.order
              ? "ORDER_OUTCOME"
              : "RISK_REJECTED",
          intentHash,
          metadata,
          payload: enrichedSnapshot,
          proposalId: enrichedSnapshot.proposalId,
        })
        .onConflictDoNothing({ target: decisionLedger.contentHash });
    });
  } catch (error) {
    log.error(
      error instanceof Error
        ? error
        : new Error("decision snapshot persistence failed"),
    );
  }
}

/**
 * Convenience shim so `technical-analysis-tool`'s snapshot shape doesn't
 * leak into the workflow caller for the few fields we record.
 */
export function snapshotInputsForTechnicals(
  technicals: TechnicalSnapshot,
): DecisionInputs["technicals"] {
  return {
    fetchedAt: technicals.fetchedAt,
    patterns: technicals.patterns,
    regime: technicals.regime,
    rsi: technicals.rsi,
    stale: technicals.stale,
    trend: technicals.trend,
  };
}
