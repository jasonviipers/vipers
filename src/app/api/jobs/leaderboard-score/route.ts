import { useLogger, withEvlog } from "@/lib/evlog";
import { runLeaderboardScoreJob } from "@/lib/jobs/leaderboard-score-job";
import { requireWriteAccess } from "@/lib/route-auth";

export const dynamic = "force-dynamic";

/**
 * POST /api/jobs/leaderboard-score — persist leaderboard scores now.
 *
 * The scheduled version starts from instrumentation.ts in production; this
 * manual trigger exists for dev and verification (the job itself is skipped
 * in dev to avoid HMR-stacked intervals). Safe to call repeatedly: each run
 * upserts one stats row per configured agent.
 */
export const POST = withEvlog(async (request: Request) => {
  const logger = useLogger();
  logger.set({ integration: "jobs" });

  // Mutating rollup trigger — write-access only (demo key is read-only).
  const auth = requireWriteAccess(request);
  if (!auth.ok) {
    return auth.response;
  }

  const result = await runLeaderboardScoreJob();

  return Response.json({ ok: true, updated: result.updated });
});
