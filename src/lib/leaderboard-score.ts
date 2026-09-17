/**
 * Leaderboard score — the single source of truth for the composite ranking.
 *
 * Server-owned so it can be persisted: the leaderboard-score job computes
 * and stores one score per agent in `agent_stats.score`, and the UI reads
 * the persisted value. The client never recomputes scores, so rankings are
 * stable across restarts and identical for every viewer.
 *
 * The activity floor keeps low-activity agents from topping the ranking:
 * agents below `MIN_TRADES` closed trades have their score scaled down
 * linearly (`trades / MIN_TRADES`), so an agent with one lucky winning
 * trade cannot outrank a consistent performer. At MIN_TRADES+ the score is
 * the raw composite, untouched.
 */

/** Minimum closed trades before an agent's score is unscaled. */
const MIN_TRADES = 10;

export interface ScoreInput {
  maxDrawdown: number;
  roi: number;
  sharpe: number;
  trades: number;
  winRate: number;
}

/** Activity multiplier in (0, 1]; 1 once the agent has MIN_TRADES trades. */
function activityFactor(trades: number): number {
  return Math.min(Math.max(trades, 0) / MIN_TRADES, 1);
}

/** Raw composite (0-100) from the performance sub-scores. */
function compositeScore(stats: ScoreInput): number {
  const roiScore = Math.min(Math.max(stats.roi, 0) / 50, 1) * 100;
  const sharpeScore = Math.min(Math.max(stats.sharpe, 0) / 3, 1) * 100;
  const wrScore = Math.min(Math.max(stats.winRate, 0), 100);
  // maxDrawdown is a positive loss magnitude in this schema, so deeper
  // drawdowns subtract from the drawdown sub-score.
  const ddScore = Math.max(0, 100 - stats.maxDrawdown * 3);
  const trScore = Math.min(stats.trades / 200, 1) * 100;
  return (
    roiScore * 0.3 +
    sharpeScore * 0.25 +
    wrScore * 0.2 +
    ddScore * 0.15 +
    trScore * 0.1
  );
}

/**
 * Final leaderboard score (0-100, integer): the composite, scaled by the
 * trade-count activity floor.
 */
export function computeLeaderboardScore(stats: ScoreInput): number {
  return Math.round(compositeScore(stats) * activityFactor(stats.trades));
}
