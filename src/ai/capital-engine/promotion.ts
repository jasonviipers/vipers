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

export interface PromotionRecord {
  configHash: string;
  dataSnapshotIds: string[];
  evaluatedAt: string;
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
  return {
    ...record,
    evaluatedAt: new Date().toISOString(),
    stage: nextStage,
  };
}
