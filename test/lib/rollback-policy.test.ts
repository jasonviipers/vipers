import { beforeEach, describe, expect, it } from "bun:test";

/**
 * Rollback-trigger policy: pure threshold semantics. At-threshold counts as
 * a breach (a budget is a ceiling, not a target), axes are independent
 * (any single breach rolls back), nothing predeclared means nothing rolls
 * back automatically, and non-capital-bearing stages never trigger.
 */

import {
  evaluateRollbackTrigger,
  isRollbackEligibleStage,
  rollbackReasonDetail,
} from "@/lib/rollback-policy";

const METRICS = {
  evaluationDays: 7,
  maxDrawdownPct: 4,
  pnl: -600,
  winRate: 0.42,
};

describe("rollback trigger policy", () => {
  let thresholds: { maxDrawdownPct: number | null; maxLossPct: number | null } =
    {
      maxDrawdownPct: 5,
      maxLossPct: 5,
    };
  let capital = 10_000;

  beforeEach(() => {
    thresholds = { maxDrawdownPct: 5, maxLossPct: 5 };
    capital = 10_000;
  });

  const evaluate = (
    headStage = "LIVE",
    metrics: typeof METRICS | null = METRICS,
  ) =>
    evaluateRollbackTrigger({
      capital,
      headStage,
      metrics,
      thresholds,
    });

  it("triggers on loss at/above the predeclared threshold", () => {
    // 600/10000 = 6% ≥ 5%.
    expect(evaluate()).toEqual({
      action: "rollback",
      reasons: ["loss-threshold"],
      trigger: true,
    });
  });

  it("triggers on drawdown at/above the predeclared threshold", () => {
    thresholds = { maxDrawdownPct: 4, maxLossPct: 10 };
    // Drawdown 4 ≥ 4; loss 6% < 10% — single-axis breach still rolls back.
    expect(evaluate()).toEqual({
      action: "rollback",
      reasons: ["drawdown-threshold"],
      trigger: true,
    });
  });

  it("reports every breached axis together", () => {
    thresholds = { maxDrawdownPct: 4, maxLossPct: 6 };
    expect(evaluate()).toEqual({
      action: "rollback",
      reasons: ["loss-threshold", "drawdown-threshold"],
      trigger: true,
    });
  });

  it("holds strictly below both thresholds", () => {
    thresholds = { maxDrawdownPct: 5, maxLossPct: 7 };
    expect(evaluate()).toEqual({ action: "hold", trigger: false });
  });

  it("treats exactly-at-threshold as a breach", () => {
    thresholds = { maxDrawdownPct: 10, maxLossPct: 6 }; // loss exactly 6%
    const result = evaluate();
    expect(result.trigger).toBe(true);
    if (result.action === "rollback") {
      expect(result.reasons).toEqual(["loss-threshold"]);
    }
  });

  it("ignores positive PnL for the loss axis", () => {
    thresholds = { maxDrawdownPct: 50, maxLossPct: 5 };
    expect(
      evaluate("LIVE", { ...METRICS, maxDrawdownPct: 2, pnl: 900 }),
    ).toEqual({ action: "hold", trigger: false });
  });

  it("refuses to act with nothing predeclared — even on disaster metrics", () => {
    thresholds = { maxDrawdownPct: null, maxLossPct: null };
    expect(evaluate()).toEqual({ action: "hold", trigger: false });
  });

  it("evaluates the armed axis only when the other is off", () => {
    thresholds = { maxDrawdownPct: 50, maxLossPct: 5 };
    // Loss 6% breaches; drawdown 4% is far from 50%.
    expect(evaluate()).toEqual({
      action: "rollback",
      reasons: ["loss-threshold"],
      trigger: true,
    });

    thresholds = { maxDrawdownPct: 3, maxLossPct: null };
    expect(evaluate()).toEqual({
      action: "rollback",
      reasons: ["drawdown-threshold"],
      trigger: true,
    });
  });

  it("never rolls back from a non-capital-bearing stage", () => {
    for (const stage of ["DRAFT", "BACKTEST", "SHADOW", "PAPER", "HALTED"]) {
      expect(evaluate(stage).action).toBe("skip");
    }
  });

  it("covers both capital-bearing stages", () => {
    expect(isRollbackEligibleStage("CANARY")).toBe(true);
    expect(isRollbackEligibleStage("LIVE")).toBe(true);
    expect(isRollbackEligibleStage("PAPER")).toBe(false);
    expect(evaluate("CANARY").trigger).toBe(true);
  });

  it("skips head records without metrics instead of inventing a threshold", () => {
    expect(evaluate("LIVE", null)).toEqual({
      action: "skip",
      reason: "no-metrics",
      trigger: false,
    });
  });

  it("does not divide by zero capital", () => {
    capital = 0;
    thresholds = { maxDrawdownPct: 3, maxLossPct: 5 };
    // Loss axis unscoreable at 0 capital; drawdown 4% still enforced.
    expect(evaluate()).toEqual({
      action: "rollback",
      reasons: ["drawdown-threshold"],
      trigger: true,
    });
  });

  it("renders an auditable reason detail", () => {
    expect(
      rollbackReasonDetail(["loss-threshold", "drawdown-threshold"], METRICS),
    ).toBe("auto-rollback: loss -600, drawdown 4%");
  });
});
