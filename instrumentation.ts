import { defineNodeInstrumentation } from "evlog/next/instrumentation";

export const { register, onRequestError } = defineNodeInstrumentation(
  () => import("./src/lib/evlog"),
);

// Hourly portfolio snapshot rollup — feeds the dashboard equity curve.
// Production only: `next dev` re-runs instrumentation on every reload and
// would stack intervals (the update-in-place upsert limits damage, but the
// timer churn and duplicate run logs are still wrong). Run it manually in
// dev via POST /api/jobs/portfolio-snapshot if needed.
if (
  process.env.NODE_ENV === "production" &&
  !process.env.NEXT_RUNTIME?.includes("edge")
) {
  const JOB_INTERVAL_MS = 60 * 60 * 1000;

  const startSnapshotJob = async () => {
    const { runPortfolioSnapshotJob } = await import(
      "./src/lib/jobs/portfolio-snapshot-job"
    );
    const { log } = await import("./src/lib/evlog");
    const run = () =>
      runPortfolioSnapshotJob().catch(() => {
        // Errors are logged inside the job; never crash the process.
      });
    // First rollup shortly after boot, then hourly.
    setTimeout(run, 15_000).unref();
    const timer = setInterval(run, JOB_INTERVAL_MS);
    timer.unref();
    log.info({ job: "portfolio-snapshot", scheduled: "hourly" });
  };

  void startSnapshotJob();
}
