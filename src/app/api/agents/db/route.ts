import { eq } from "drizzle-orm";

import { db } from "@/db";
import { agentStats, agents, equitySnapshots } from "@/db/schema/agent";
import { useLogger, withEvlog } from "@/lib/evlog";
import { getRuntimeSettings } from "@/lib/runtime-settings";
import { agentConfigs } from "@/mastra/agents/config";
import { agentRuntime } from "@/mastra/runtime/agent-runtime";

export const dynamic = "force-dynamic";

/**
 * GET /api/agents/db — the agents-view fleet payload.
 *
 * Merges three sources:
 *  - `agentConfigs` (identity: team, role, model) — always present
 *  - runtime status (health, heartbeats, metrics) — process-local
 *  - `agents` + `agent_stats` + `equity_snapshots` DB rows (status, PnL
 *    stats, equity sparkline)
 *
 * DB rows are optional flavor: if the table is empty (fresh install) or the
 * database is unreachable, every configured agent still appears with zeroed
 * stats. No invented performance history is ever generated.
 */
export const GET = withEvlog(async () => {
  const logger = useLogger();
  logger.set({ integration: "agents" });

  interface DbFlavor {
    equity: number[];
    maxDrawdown: number;
    pnl: number;
    roi: number;
    score: number | null;
    scoreComputedAt: string | null;
    sharpe: number;
    status: string;
    trades: number;
    winRate: number;
  }
  const flavor = new Map<string, DbFlavor>();

  try {
    const dbAgents = await db.select().from(agents);
    for (const row of dbAgents) {
      const [stats] = await db
        .select()
        .from(agentStats)
        .where(eq(agentStats.agentId, row.id));
      const snapshots = await db
        .select({ value: equitySnapshots.value })
        .from(equitySnapshots)
        .where(eq(equitySnapshots.agentId, row.id))
        .orderBy(equitySnapshots.recordedAt)
        .limit(30);

      flavor.set(row.id, {
        equity: snapshots.map((s) => Number(s.value)),
        maxDrawdown: Number(stats?.maxDrawdown ?? 0),
        pnl: Number(stats?.pnl ?? 0),
        roi: Number(stats?.roi ?? 0),
        score: stats?.score != null ? Number(stats.score) : null,
        scoreComputedAt: stats?.scoreComputedAt
          ? stats.scoreComputedAt.toISOString()
          : null,
        sharpe: Number(stats?.sharpe ?? 0),
        status: row.status,
        trades: stats?.trades ?? 0,
        winRate: Number(stats?.winRate ?? 0),
      });
    }
  } catch (error) {
    logger.set({
      warning: `agent db unavailable, serving catalog: ${
        error instanceof Error ? error.message : "unknown"
      }`,
    });
  }

  // Online window scales with the operator's heartbeat-interval setting
  // (PUT /api/settings/runtime): an agent is online if we heard a heartbeat
  // within 3 × the configured interval (bounded to sane min/max).
  const settings = await getRuntimeSettings();
  const onlineWindowMs =
    Math.min(Math.max(settings.heartbeatInterval * 3, 30), 600) * 1000;

  const items = agentConfigs.map((config) => {
    const dbRow = flavor.get(config.id);
    const runtime = agentRuntime.getStatus(config.id);
    const lastHeartbeatAt = runtime?.lastHeartbeatAt ?? null;
    // Online iff we've heard a heartbeat recently. The runtime marks agents
    // HEALTHY and records a heartbeat on every handled event, so a fresh
    // heartbeat means the agent is participating in the pipeline.
    const heartbeatAgeMs = lastHeartbeatAt
      ? Date.now() - new Date(lastHeartbeatAt).getTime()
      : Number.POSITIVE_INFINITY;
    const online = heartbeatAgeMs < onlineWindowMs;

    return {
      id: config.id,
      codename: config.codename ?? null,
      maxConcurrency: config.maxConcurrency,
      model: config.model,
      role: config.role,
      team: config.team,
      timeoutMs: config.timeoutMs,
      tools: config.tools,
      status: dbRow?.status ?? (online ? "online" : "offline"),
      runtime: {
        health: runtime?.health ?? "OFFLINE",
        lastHeartbeatAt,
        metrics: runtime?.metrics ?? {
          avgHandleTimeMs: null,
          errors: 0,
          eventsHandled: 0,
        },
      },
      stats: {
        equityData: dbRow?.equity ?? [],
        maxDrawdown: dbRow?.maxDrawdown ?? 0,
        pnl: dbRow?.pnl ?? 0,
        roi: dbRow?.roi ?? 0,
        /** Persisted leaderboard score; null until the score job has run. */
        score: dbRow?.score ?? null,
        scoreComputedAt: dbRow?.scoreComputedAt ?? null,
        sharpe: dbRow?.sharpe ?? 0,
        trades: dbRow?.trades ?? 0,
        winRate: dbRow?.winRate ?? 0,
      },
    };
  });

  return Response.json({
    items,
    onlineCount: items.filter((a) => a.status === "online").length,
    /** Online-window seconds derived from the operator heartbeat setting. */
    onlineWindowS: onlineWindowMs / 1000,
    total: items.length,
  });
});
