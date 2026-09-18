import { eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { agentStats, agents } from "@/db/schema/agent";
import { positions } from "@/db/schema/trading";
import { log } from "@/lib/evlog";
import { computeLeaderboardScore } from "@/lib/leaderboard-score";

/**
 * Leaderboard score rollup job.
 *
 * Persists the composite leaderboard score for every agent into
 * `agent_stats.score` (with `score_computed_at`), so rankings are stable
 * across process restarts and identical for every viewer — the client
 * never recomputes.
 *
 * Stats themselves are derived from positions (see schema notes), so the
 * job reads the same cached aggregates the fleet route serves: for each
 * configured agent it recomputes pnl/roi/sharpe/winRate/trades/maxDrawdown
 * from the positions table, upserts the stats row, and stores the score.
 *
 * Idempotent: running twice within a window just overwrites the same rows.
 */
export async function runLeaderboardScoreJob(): Promise<{ updated: number }> {
  try {
    // Per-agent closed-trade aggregates straight from the positions table.
    // winRate counts non-losing closes as wins (matches the cached stat
    // convention); maxDrawdown stays approximate from worst close buckets —
    // the price-tick job keeps pnl current per tick, so the worst realized
    // pnl per agent is the loss floor used for ranking.
    const rows = await db
      .select({
        agentId: positions.agentId,
        losses: sql<number>`count(*) filter (where ${positions.pnl} < 0)::int`,
        maxLoss: sql<string>`coalesce(min(${positions.pnl}), '0')`,
        pnl: sql<string>`coalesce(sum(${positions.pnl}), '0')`,
        trades: sql<number>`count(*)::int`,
        wins: sql<number>`count(*) filter (where ${positions.pnl} >= 0)::int`,
      })
      .from(positions)
      .where(eq(positions.status, "CLOSED"))
      .groupBy(positions.agentId);

    const statsByAgent = new Map(rows.map((r) => [r.agentId, r]));

    // Every configured agent gets a row, even with zero trades — zeroed
    // stats keep them visible (and floor-scaled) on the leaderboard.
    const allAgents = await db.select({ id: agents.id }).from(agents);

    // Upserts are independent per agent (distinct agentId), so the whole
    // set runs concurrently instead of serially.
    await Promise.all(
      allAgents.map(async (agent) => {
        const stats = statsByAgent.get(agent.id);
        const trades = stats?.trades ?? 0;
        const wins = stats?.wins ?? 0;
        const losses = stats?.losses ?? 0;
        const pnl = Number(stats?.pnl ?? 0);

        // Conservative derivations (no invested-capital history is stored):
        // roi over a nominal 1000 book, sharpe from the win/loss split.
        const roi = trades > 0 ? (pnl / 1000) * 100 : 0;
        const winRate = trades > 0 ? (wins / trades) * 100 : 0;
        const maxDrawdown = Math.max(
          0,
          (-Number(stats?.maxLoss ?? 0) / 1000) * 100,
        );
        const sharpe =
          trades > 0 && losses > 0
            ? (winRate / 100 - losses / trades) / Math.sqrt(trades)
            : trades > 0
              ? 1
              : 0;

        const score = computeLeaderboardScore({
          maxDrawdown,
          roi,
          sharpe,
          trades,
          winRate,
        });

        await db
          .insert(agentStats)
          .values({
            agentId: agent.id,
            maxDrawdown: maxDrawdown.toString(),
            pnl: pnl.toString(),
            roi: roi.toString(),
            score: score.toString(),
            scoreComputedAt: new Date(),
            sharpe: sharpe.toString(),
            trades,
            winRate: winRate.toString(),
          })
          .onConflictDoUpdate({
            target: agentStats.agentId,
            set: {
              maxDrawdown: maxDrawdown.toString(),
              pnl: pnl.toString(),
              roi: roi.toString(),
              score: score.toString(),
              scoreComputedAt: new Date(),
              sharpe: sharpe.toString(),
              trades,
              winRate: winRate.toString(),
              updatedAt: new Date(),
            },
          });
      }),
    );
    const updated = allAgents.length;

    log.info({ job: "leaderboard-score", updated });
    return { updated };
  } catch (error) {
    // The job must never crash the process; the next interval retries.
    log.error(
      error instanceof Error
        ? error
        : new Error("leaderboard score job failed"),
    );
    return { updated: 0 };
  }
}
