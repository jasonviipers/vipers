import type { PromotionMetrics } from "@/ai/capital-engine/promotion";

/**
 * Predeclared automatic rollback triggers — the pure decision core for the
 * strategy-rollback monitor (src/lib/jobs/strategy-rollback-job.ts).
 *
 * A capital-bearing plugin (head record at CANARY or LIVE) is disabled
 * through the audited kill switch when its head evaluation metrics breach a
 * PREDECLARED threshold: breach ⇔ metric ≥ threshold (at-threshold counts —
 * a budget is a ceiling, not a target). Both axes are independent: any
 * single breach rolls back. Thresholds are operator settings
 * (rollback_max_loss_pct / rollback_max_drawdown_pct); null means the
 * trigger is NOT armed — metrics are never compared against a default,
 * because an automatic kill must be deliberately predeclared, never
 * inherited from a heuristic.
 *
 * The core is pure (no I/O) so the thresholds and comparisons can be
 * property-tested deterministically; the job supplies live data.
 */

export interface RollbackThresholds {
  /** Max loss over the evaluation window, percent (null = trigger off). */
  maxLossPct: number | null;
  /** Max peak-to-trough drawdown, percent (null = trigger off). */
  maxDrawdownPct: number | null;
}

export type RollbackTriggerReason = "drawdown-threshold" | "loss-threshold";

export type RollbackEvaluation =
  | {
      action: "rollback";
      /** Every axis that breached — the audit record carries all of them. */
      reasons: RollbackTriggerReason[];
      trigger: true;
    }
  | { action: "hold"; trigger: false }
  | {
      action: "skip";
      reason: "no-metrics" | "not-capital-bearing";
      trigger: false;
    };

/** Stages where the plugin holds capital and auto-rollback applies. */
const ROLLBACK_ELIGIBLE_STAGES = ["CANARY", "LIVE"] as const;

export function isRollbackEligibleStage(
  stage: string,
): stage is (typeof ROLLBACK_ELIGIBLE_STAGES)[number] {
  return (ROLLBACK_ELIGIBLE_STAGES as readonly string[]).includes(stage);
}

/**
 * Evaluate one plugin's head record against the predeclared thresholds.
 * Loss percent is derived from the window's realized PnL vs the window's
 * starting capital when the caller can supply it; the head metrics carry
 * only absolute PnL, so the caller passes the capital denominator.
 */
export function evaluateRollbackTrigger(input: {
  capital: number;
  headStage: string;
  metrics: PromotionMetrics | null;
  thresholds: RollbackThresholds;
}): RollbackEvaluation {
  if (!isRollbackEligibleStage(input.headStage)) {
    return { action: "skip", reason: "not-capital-bearing", trigger: false };
  }
  if (
    input.thresholds.maxLossPct === null &&
    input.thresholds.maxDrawdownPct === null
  ) {
    // Nothing predeclared — the monitor must never invent a threshold.
    return { action: "hold", trigger: false };
  }
  if (!input.metrics) {
    return { action: "skip", reason: "no-metrics", trigger: false };
  }

  const reasons: RollbackTriggerReason[] = [];

  if (input.thresholds.maxLossPct !== null && input.capital > 0) {
    const lossPct =
      input.metrics.pnl < 0 ? (-input.metrics.pnl / input.capital) * 100 : 0;
    if (lossPct >= input.thresholds.maxLossPct) {
      reasons.push("loss-threshold");
    }
  }

  if (
    input.thresholds.maxDrawdownPct !== null &&
    input.metrics.maxDrawdownPct >= input.thresholds.maxDrawdownPct
  ) {
    reasons.push("drawdown-threshold");
  }

  if (reasons.length === 0) {
    return { action: "hold", trigger: false };
  }
  return { action: "rollback", reasons, trigger: true };
}

/** Human-auditable reason detail for the HALTED lineage annotation. */
export function rollbackReasonDetail(
  reasons: RollbackTriggerReason[],
  metrics: PromotionMetrics,
): string {
  const parts: string[] = [];
  if (reasons.includes("loss-threshold")) {
    parts.push(`loss ${metrics.pnl}`);
  }
  if (reasons.includes("drawdown-threshold")) {
    parts.push(`drawdown ${metrics.maxDrawdownPct}%`);
  }
  return `auto-rollback: ${parts.join(", ")}`;
}
