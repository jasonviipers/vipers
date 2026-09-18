import { getLogger, withEvlog } from "@/lib/evlog";
import {
  previewStrategyRollbacks,
  runStrategyRollbackMonitor,
} from "@/lib/jobs/strategy-rollback-job";
import { requireWriteAccess } from "@/lib/route-auth";

export const dynamic = "force-dynamic";

/**
 * POST /api/jobs/strategy-rollback — run the automatic rollback monitor
 * now (the scheduled version starts from instrumentation.ts in production).
 *
 * Body (optional): { "dryRun": true } — evaluate every plugin against the
 * predeclared thresholds and report what WOULD be rolled back, executing
 * nothing. Use this to verify thresholds before arming them: an automatic
 * kill is a predeclared, deliberate act, and the dry run shows exactly
 * which plugins breach at the current settings and capital denominator.
 */
export const POST = withEvlog(async (request: Request) => {
  const logger = getLogger();
  logger.set({ integration: "jobs" });

  // Mutating trigger — write-access only (demo key is read-only).
  const auth = requireWriteAccess(request);
  if (!auth.ok) {
    return auth.response;
  }

  let dryRun = false;
  try {
    const body = (await request.json()) as { dryRun?: unknown };
    dryRun = body?.dryRun === true;
  } catch {
    // No/invalid body: execute.
  }

  if (dryRun) {
    const previews = await previewStrategyRollbacks();
    logger.set({ dryRun: true, job: "strategy-rollback" });
    return Response.json({
      dryRun: true,
      plugins: previews.map((p) => ({
        pluginId: p.pluginId,
        result: p.result,
        stage: p.head?.stage ?? null,
      })),
    });
  }

  const summary = await runStrategyRollbackMonitor();
  return Response.json({ ok: true, summary });
});
