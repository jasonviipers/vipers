/**
 * ANALYSIS team data source: technical indicators, market regime detection
 * and pattern analysis. Deterministic stub; replace the body with a real
 * market data provider when one is wired up.
 */
export interface TechnicalSnapshot {
  patterns: string[];
  regime: "TRENDING" | "RANGE_BOUND" | "VOLATILE";
  rsi: number;
  trend: "UP" | "DOWN" | "SIDEWAYS";
}

export function fetchTechnicals(asset: string): TechnicalSnapshot {
  const seed = asset.length % 3;
  let trend: TechnicalSnapshot["trend"] = "UP";
  if (seed === 1) {
    trend = "SIDEWAYS";
  } else if (seed === 2) {
    trend = "DOWN";
  }
  return {
    patterns: [`[stub] ${asset}: higher-lows structure on 4h`],
    regime: seed === 2 ? "VOLATILE" : "TRENDING",
    rsi: 35 + seed * 15,
    trend,
  };
}
