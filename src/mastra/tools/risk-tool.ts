/**
 * RISK team logic: the mandatory gate. Consensus approval is advisory; only
 * a RISK_APPROVED proposal may proceed to execution.
 */
export interface RiskLimits {
  maxDailyLossPct: number;
  maxPositionPct: number;
}

export interface RiskEvaluation {
  approved: boolean;
  positionSizePct: number;
  reason: string;
}

const MIN_CONFIDENCE_FLOOR = 0.6;

export function evaluateProposalRisk(
  input: {
    asset: string;
    confidence: number;
  },
  limits: RiskLimits,
): RiskEvaluation {
  if (input.confidence < MIN_CONFIDENCE_FLOOR) {
    return {
      approved: false,
      positionSizePct: 0,
      reason: `Confidence ${input.confidence} below the ${MIN_CONFIDENCE_FLOOR} hard floor`,
    };
  }

  // Scale the position with confidence but never exceed the configured cap.
  const positionSizePct = Number(
    Math.min(
      limits.maxPositionPct,
      input.confidence * limits.maxPositionPct,
    ).toFixed(2),
  );

  return {
    approved: true,
    positionSizePct,
    reason: `Within limits: ${positionSizePct}% of book on ${input.asset}, daily loss cap ${limits.maxDailyLossPct}%`,
  };
}
