import { describe, expect, it } from "bun:test";

import {
  evaluateProposalRisk,
  type RiskGateContext,
  type RiskLimits,
} from "./risk-tool";

const BASE_LIMITS: RiskLimits = { maxDailyLossPct: 3, maxPositionPct: 5 };

function ctx(overrides: Partial<RiskGateContext> = {}): RiskGateContext {
  return {
    dailyRealizedPnl: 0,
    killSwitchEnabled: false,
    totalCapital: 100_000,
    ...overrides,
  };
}

describe("evaluateProposalRisk", () => {
  it("approves within limits and scales size with confidence", () => {
    const result = evaluateProposalRisk(
      { asset: "BTC-USD", confidence: 0.8 },
      BASE_LIMITS,
      ctx(),
    );
    expect(result.approved).toBe(true);
    // 0.8 * 5% = 4%
    expect(result.positionSizePct).toBe(4);
  });

  it("caps position size at maxPositionPct", () => {
    const result = evaluateProposalRisk(
      { asset: "BTC-USD", confidence: 1 },
      BASE_LIMITS,
      ctx(),
    );
    expect(result.approved).toBe(true);
    expect(result.positionSizePct).toBe(5);
  });

  it("rejects below the confidence floor", () => {
    const result = evaluateProposalRisk(
      { asset: "BTC-USD", confidence: 0.59 },
      BASE_LIMITS,
      ctx(),
    );
    expect(result.approved).toBe(false);
    expect(result.positionSizePct).toBe(0);
  });

  it("kill switch rejects before any other rule", () => {
    const result = evaluateProposalRisk(
      { asset: "BTC-USD", confidence: 1 },
      BASE_LIMITS,
      ctx({ killSwitchEnabled: true }),
    );
    expect(result.approved).toBe(false);
    expect(result.positionSizePct).toBe(0);
    expect(result.reason).toContain("KILL SWITCH");
  });

  it("rejects when realized daily loss reaches the cap", () => {
    // 3.5% loss on 100k capital exceeds the 3% cap.
    const result = evaluateProposalRisk(
      { asset: "BTC-USD", confidence: 0.9 },
      BASE_LIMITS,
      ctx({ dailyRealizedPnl: -3_500 }),
    );
    expect(result.approved).toBe(false);
    expect(result.reason).toContain("cap");
  });

  it("rejects exactly at the cap (no reopening the door)", () => {
    const result = evaluateProposalRisk(
      { asset: "BTC-USD", confidence: 0.9 },
      BASE_LIMITS,
      ctx({ dailyRealizedPnl: -3_000 }),
    );
    expect(result.approved).toBe(false);
  });

  it("approves below the cap", () => {
    const result = evaluateProposalRisk(
      { asset: "BTC-USD", confidence: 0.9 },
      BASE_LIMITS,
      ctx({ dailyRealizedPnl: -2_999 }),
    );
    expect(result.approved).toBe(true);
  });

  it("ignores positive daily PnL", () => {
    const result = evaluateProposalRisk(
      { asset: "BTC-USD", confidence: 0.9 },
      BASE_LIMITS,
      ctx({ dailyRealizedPnl: 5_000 }),
    );
    expect(result.approved).toBe(true);
  });

  it("skips the loss cap when total capital is unknown (no snapshot, empty ledger)", () => {
    // Fresh install: capital can't be derived, so the percentage is
    // undefined — the gate falls through to the confidence rules.
    const result = evaluateProposalRisk(
      { asset: "BTC-USD", confidence: 0.9 },
      BASE_LIMITS,
      ctx({ dailyRealizedPnl: -5_000, totalCapital: 0 }),
    );
    expect(result.approved).toBe(true);
  });

  it("kill switch takes priority over the daily-loss cap", () => {
    const result = evaluateProposalRisk(
      { asset: "BTC-USD", confidence: 0.9 },
      BASE_LIMITS,
      ctx({ dailyRealizedPnl: -5_000, killSwitchEnabled: true }),
    );
    expect(result.reason).toContain("KILL SWITCH");
  });
});
