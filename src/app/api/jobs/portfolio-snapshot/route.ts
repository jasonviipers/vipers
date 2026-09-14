import { useLogger, withEvlog } from "@/lib/evlog";
import {
  backfillPortfolioSnapshots,
  runPortfolioSnapshotJob,
} from "@/lib/jobs/portfolio-snapshot-job";
import { requireWriteAccess } from "@/lib/route-auth";

export const dynamic = "force-dynamic";

/**
 * POST /api/jobs/portfolio-snapshot — run the hourly rollup now, optionally
 * backfilling history from the ledger first.
 *
 * The scheduled version starts from instrumentation.ts in production; this
 * manual trigger exists for dev and verification (the job itself is skipped
 * in dev to avoid HMR-stacked intervals). Safe to call repeatedly: the
 * rollup updates in place within the same clock-hour, and the backfill
 * skips hours that already have a snapshot.
 *
 * Body (all optional): { "backfillDays": 7 }
 */
export const POST = withEvlog(async (request: Request) => {
  const logger = useLogger();
  logger.set({ integration: "jobs" });

  // Mutating rollup trigger — write-access only (demo key is read-only).
  const auth = requireWriteAccess(request);
  if (!auth.ok) {
    return auth.response;
  }

  let backfillDays: number | undefined;
  try {
    const body = (await request.json()) as { backfillDays?: unknown };
    if (typeof body?.backfillDays === "number" && body.backfillDays > 0) {
      backfillDays = Math.min(90, Math.floor(body.backfillDays));
    }
  } catch {
    // No/invalid body: rollup only.
  }

  const backfilled = backfillDays
    ? await backfillPortfolioSnapshots({ days: backfillDays })
    : 0;

  await runPortfolioSnapshotJob();

  return Response.json({ backfilled, ok: true });
});
