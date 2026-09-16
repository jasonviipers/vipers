import { describe, expect, it } from "bun:test";

import {
  createCapitalIntent,
  createNoTradeDecision,
  hashCapitalIntent,
} from "@/ai/capital-engine/intent";

const base = {
  asset: "BTC",
  confidence: 0.82,
  proposalId: "prp_test",
  reasoning: "Trend and sentiment agree.",
  signalId: "sig_test",
  signalFetchedAt: 1_000,
  technicalsFetchedAt: 2_000,
};

describe("capital intent", () => {
  it("produces the same hash regardless of object key order", () => {
    const first = createCapitalIntent({ ...base, direction: "LONG" });
    const second = {
      strategyVersion: "consensus-v1",
      signalId: "sig_test",
      reasoning: "Trend and sentiment agree.",
      proposalId: "prp_test",
      evidence: {
        technicalsFetchedAt: 2_000,
        signalFetchedAt: 1_000,
        signalId: "sig_test",
      },
      direction: "LONG" as const,
      confidence: 0.82,
      asset: "BTC",
    };

    expect(hashCapitalIntent(first)).toBe(hashCapitalIntent(second));
  });

  it("changes when a decision-bearing field changes", () => {
    const first = createCapitalIntent({ ...base, direction: "LONG" });
    const changed = createCapitalIntent({
      ...base,
      direction: "SHORT",
    });

    expect(hashCapitalIntent(first)).not.toBe(hashCapitalIntent(changed));
  });

  it("represents abstention as an auditable NO_TRADE decision", () => {
    const decision = createNoTradeDecision({
      ...base,
      reason: "Evidence conflicts.",
    });

    expect(decision.decision).toBe("NO_TRADE");
    expect(hashCapitalIntent(decision)).toMatch(/^[a-f0-9]{64}$/);
  });
});
