import { describe, expect, it } from "bun:test";

import {
  type DecisionSnapshot,
  hashDecision,
  replayDecisionSnapshot,
} from "@/ai/audit/decision-snapshot";
import {
  createRiskVerdict,
  riskVerdictFromEvaluation,
} from "@/ai/capital-engine/risk-verdict";

describe("risk verdict and decision replay", () => {
  it("constructs explicit approved and rejected verdicts", () => {
    expect(
      riskVerdictFromEvaluation({ approved: true, reason: "within limits" }),
    ).toMatchObject({ code: "APPROVED", policyVersion: "risk-v1" });
    expect(
      createRiskVerdict({
        code: "UNAVAILABLE",
        policyVersion: "risk-v2",
        reason: "market data unavailable",
        evaluatedAt: "2026-09-16T00:00:00.000Z",
      }).code,
    ).toBe("UNAVAILABLE");
  });

  it("replays and verifies a stored decision without invoking execution", () => {
    const snapshot: DecisionSnapshot = {
      asset: "BTC",
      inputs: {
        consensus: {
          confidence: 0.8,
          direction: "LONG",
          quorum: 1,
          votesAgainst: 0,
          votesFor: 1,
        },
        proposal: {
          agentId: "agent",
          asset: "BTC",
          confidence: 0.8,
          direction: "LONG",
          proposalId: "proposal",
          reasoning: "trend",
          signalId: "signal",
        },
        signal: {
          asset: "BTC",
          confidence: 0.8,
          fetchedAt: 1,
          highlights: [],
          sentimentBreakdown: { redditScore: 0, rssScore: 0 },
          sentimentSocialVolume: 0,
          sentimentSources: { reddit: 0, rss: 0 },
          signalId: "signal",
        },
        technicals: {
          fetchedAt: 2,
          patterns: [],
          regime: "trend",
          rsi: 50,
          trend: "up",
        },
      },
      metadata: {
        correlationId: "proposal",
        dataTimestamps: [1, 2],
        pluginConfigHash: null,
        pluginId: "consensus-v1",
        pluginVersion: "consensus-v1",
        policyVersion: "risk-v1",
      },
      outcome: {
        order: null,
        risk: {
          approved: true,
          positionSizePct: 2,
          reason: "within limits",
        },
      },
      proposalId: "proposal",
      signalId: "signal",
    };

    const replay = replayDecisionSnapshot({
      contentHash: hashDecision(snapshot),
      snapshot,
    });

    expect(replay.verified).toBe(true);
    expect(replay.riskVerdict.code).toBe("APPROVED");
  });
});
