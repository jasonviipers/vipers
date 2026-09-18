import { defineNodeInstrumentation } from "evlog/next/instrumentation";

export const { register, onRequestError } = defineNodeInstrumentation(
  () => import("./src/lib/evlog"),
);

if (process.env.NEXT_RUNTIME === "nodejs") {
  // Agent automation heartbeat: a short fixed tick reads the operator's
  // automation setting + interval from the DB every 15s and triggers a full
  // consensus-workflow pass when due. Default OFF; enabling it in /settings
  // starts the loop without a redeploy. HMR-safe via globalThis guard.
  const startAutomation = async () => {
    const globalStore = globalThis as typeof globalThis & {
      __automationLoopStarted?: boolean;
    };
    if (globalStore.__automationLoopStarted) {
      return;
    }
    globalStore.__automationLoopStarted = true;
    const { startAutomationLoop } = await import(
      "./src/lib/jobs/automation-job"
    );
    startAutomationLoop();
  };
  void startAutomation();

  // OKX credential health probe at boot: a stored-but-broken credential set
  // (expired demo key, mistyped secret, wrong region) otherwise surfaces
  // only at the first failed order. Safe in dev too — HMR re-runs
  // instrumentation on reload, so the timer is guarded via globalThis to
  // avoid stacking probes.
  const startHealthCheck = async () => {
    const globalStore = globalThis as typeof globalThis & {
      __brokerHealthCheckStarted?: boolean;
    };
    if (globalStore.__brokerHealthCheckStarted) {
      return;
    }
    globalStore.__brokerHealthCheckStarted = true;
    const { runStartupBrokerHealthCheck } = await import(
      "./src/lib/broker-health"
    );
    // Small delay lets the DB pool settle before the probe.
    setTimeout(() => {
      void runStartupBrokerHealthCheck();
    }, 5_000).unref();
  };
  void startHealthCheck();

  // Hourly portfolio snapshot rollup — feeds the dashboard equity curve.
  // Production only: `next dev` re-runs instrumentation on every reload and
  // would stack intervals (the update-in-place upsert limits damage, but the
  // timer churn and duplicate run logs are still wrong). Run it manually in
  // dev via POST /api/jobs/portfolio-snapshot if needed.
  if (process.env.NODE_ENV === "production") {
    const JOB_INTERVAL_MS = 60 * 60 * 1000;

    const startSnapshotJob = async () => {
      const [{ runPortfolioSnapshotJob }, { log }] = await Promise.all([
        import("./src/lib/jobs/portfolio-snapshot-job"),
        import("./src/lib/evlog"),
      ]);
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

    // Reconcile orders whose broker result or position persistence was
    // uncertain. The worker only finalizes confirmed terminal exchange
    // states; live/partial/error outcomes remain PENDING and are retried.
    const startOrderReconciliationJob = async () => {
      const [{ reconcilePendingOrders }, { log }] = await Promise.all([
        import("./src/lib/jobs/order-reconciliation-job"),
        import("./src/lib/evlog"),
      ]);
      const run = () =>
        reconcilePendingOrders().catch(() => {
          // Per-order failures are logged inside the worker; never crash the process.
        });
      setTimeout(run, 30_000).unref();
      const timer = setInterval(run, 60_000);
      timer.unref();
      log.info({ job: "order-reconciliation", scheduled: "every-minute" });
    };

    void startOrderReconciliationJob();

    // Strategy rollback monitor: evaluates predeclared rollback thresholds
    // (runtime settings) against the lineage-head metrics of enabled,
    // capital-bearing plugins and halts breaches through the audited kill
    // switch. No-op pass unless the operator predeclared a threshold.
    const startRollbackMonitor = async () => {
      const [{ runStrategyRollbackMonitor }, { log }] = await Promise.all([
        import("./src/lib/jobs/strategy-rollback-job"),
        import("./src/lib/evlog"),
      ]);
      const run = () =>
        runStrategyRollbackMonitor().catch(() => {
          // Failures are logged inside the monitor; never crash the process.
        });
      setTimeout(run, 45_000).unref();
      const timer = setInterval(run, 60_000);
      timer.unref();
      log.info({ job: "strategy-rollback", scheduled: "every-minute" });
    };

    void startRollbackMonitor();

    // Leaderboard score rollup — persists per-agent composite scores so
    // rankings survive restarts (same cadence as the snapshot job; scores
    // only move when trades close, so hourly is plenty).
    const startScoreJob = async () => {
      const [{ runLeaderboardScoreJob }, { log }] = await Promise.all([
        import("./src/lib/jobs/leaderboard-score-job"),
        import("./src/lib/evlog"),
      ]);
      const run = () =>
        runLeaderboardScoreJob().catch(() => {
          // Errors are logged inside the job; never crash the process.
        });
      setTimeout(run, 20_000).unref();
      const timer = setInterval(run, JOB_INTERVAL_MS);
      timer.unref();
      log.info({ job: "leaderboard-score", scheduled: "hourly" });
    };

    void startScoreJob();
  }
}
