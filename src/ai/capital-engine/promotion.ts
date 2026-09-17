export const PROMOTION_STAGES = [
  "DRAFT",
  "BACKTEST",
  "WALK_FORWARD",
  "SHADOW",
  "PAPER",
  "CANARY",
  "LIVE",
  "HALTED",
] as const;

export type PromotionStage = (typeof PROMOTION_STAGES)[number];

const ALLOWED_TRANSITIONS: Record<PromotionStage, readonly PromotionStage[]> = {
  DRAFT: ["BACKTEST", "HALTED"],
  BACKTEST: ["WALK_FORWARD", "HALTED"],
  WALK_FORWARD: ["SHADOW", "HALTED"],
  SHADOW: ["PAPER", "HALTED"],
  PAPER: ["CANARY", "HALTED"],
  CANARY: ["LIVE", "HALTED"],
  LIVE: ["HALTED"],
  HALTED: ["DRAFT"],
};

export interface PromotionMetrics {
  /** Win rate 0-1 over the evaluation window. */
  winRate: number;
  /** Realized PnL in account currency over the evaluation window. */
  pnl: number;
  /** Maximum peak-to-trough drawdown percent over the window. */
  maxDrawdownPct: number;
  /** Evaluation window length in days. */
  evaluationDays: number;
}

export interface PromotionRecord {
  configHash: string;
  dataSnapshotIds: string[];
  evaluatedAt: string;
  /** Evaluation metrics for the stage being recorded (null when none). */
  metrics: PromotionMetrics | null;
  pluginId: string;
  pluginVersion: string;
  policyHash: string;
  stage: PromotionStage;
}

export function canAdvancePromotion(
  from: PromotionStage,
  to: PromotionStage,
): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/**
 * Advance only through the controlled promotion path. Hashes identify the
 * exact strategy/config/data/risk policy evaluated; callers must create a new
 * record when any of them changes.
 */
export function advancePromotion(
  record: PromotionRecord,
  nextStage: PromotionStage,
): PromotionRecord {
  if (!canAdvancePromotion(record.stage, nextStage)) {
    throw new Error(
      `Invalid promotion transition: ${record.stage} -> ${nextStage}`,
    );
  }
  if (
    !record.pluginId ||
    !record.pluginVersion ||
    !record.configHash ||
    !record.policyHash ||
    record.dataSnapshotIds.length === 0
  ) {
    throw new Error(
      "Promotion record is missing immutable evaluation metadata",
    );
  }
  // A stage whose whole point is evaluation evidence must carry that
  // evidence: metrics are REQUIRED for advancement past DRAFT, backtest
  // metrics past BACKTEST, and walk-forward metrics past WALK_FORWARD.
  if (
    (record.stage === "BACKTEST" ||
      record.stage === "WALK_FORWARD" ||
      record.stage === "SHADOW" ||
      record.stage === "PAPER" ||
      record.stage === "CANARY" ||
      record.stage === "LIVE") &&
    !record.metrics
  ) {
    throw new Error(
      `Promotion record at stage ${record.stage} is missing evaluation metrics`,
    );
  }
  return {
    ...record,
    evaluatedAt: new Date().toISOString(),
    stage: nextStage,
  };
}
