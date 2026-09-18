import { eq } from "drizzle-orm";
import { runConsensusWorkflow } from "@/ai/workflows/consensus-workflow";
import { db } from "@/db";
import { riskControls } from "@/db/schema/risk";
import { log } from "@/lib/evlog";
import { getRuntimeSettings } from "@/lib/runtime-settings";

/**
 * Agent automation job: the autonomous trading loop.
 *
 * Gated by the operator's AGENT AUTOMATION setting (PUT /api/settings/runtime,
 * default OFF — the swarm never trades uninvited). When enabled, each pass
 * triggers one full consensus-workflow run:
 *
 *   SENTIMENT signal → ANALYSIS proposal → COORDINATION vote →
 *   RISK hard gate → EXECUTION
 *
 * Defense in depth on top of the toggle:
 * - the kill switch (risk_controls) short-circuits the pass before any LLM
 *   spend, even though the risk gate re-checks it per proposal;
 * - assets rotate per pass so each ticker gets a full pipeline pass in turn;
 * - an in-flight guard prevents overlapping runs (an LLM pass can outlive
 *   a short interval);
 * - workflow runs are awaited so failures surface in the tick log.
 *
 * The workflow itself enforces everything downstream (quorum, risk caps,
 * idempotent order submission); this job only decides WHEN to run it.
 */

const AUTOMATION_ASSETS = ["BTC", "ETH", "SOL", "XRP", "DOGE"] as const;

type AutomationTickResult =
  | { action: "ran"; asset: string; orderStatus: string }
  | { action: "skipped"; reason: string }
  | { action: "failed"; asset: string; reason: string };

let tickCount = 0;
let inFlight = false;

/** True when the server-owned kill switch is armed. */
async function isKillSwitchArmed(): Promise<boolean> {
  const [row] = await db
    .select({ enabled: riskControls.killSwitchEnabled })
    .from(riskControls)
    .where(eq(riskControls.id, "global"));
  return row?.enabled ?? false;
}

/**
 * Run one automation pass. Returns what happened so the scheduler (and the
 * manual trigger route) can report it. Never throws — every failure mode is
 * a logged result.
 */
async function runAutomationTick(): Promise<AutomationTickResult> {
  if (inFlight) {
    return { action: "skipped", reason: "previous pass still running" };
  }
  inFlight = true;
  try {
    const settings = await getRuntimeSettings();
    if (!settings.automationEnabled) {
      return { action: "skipped", reason: "automation disabled by operator" };
    }
    if (await isKillSwitchArmed()) {
      return { action: "skipped", reason: "kill switch armed" };
    }

    const asset = AUTOMATION_ASSETS[tickCount % AUTOMATION_ASSETS.length];
    tickCount += 1;

    const result = await runConsensusWorkflow({
      asset,
      source: "automation",
    });

    const orderStatus = result.order.status;
    log.info({
      action: "automation_pass",
      asset,
      job: "automation",
      orderStatus,
    });
    return { action: "ran", asset, orderStatus };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown error";
    log.error(
      error instanceof Error ? error : new Error("automation pass failed"),
    );
    return {
      action: "failed",
      asset: "unknown",
      reason,
    };
  } finally {
    inFlight = false;
  }
}

/**
 * The scheduler loop. A short fixed heartbeat reads the operator's interval
 * setting every tick, so cadence changes apply without a redeploy and the
 * long-interval timer is never stacked (dev/HMR safe).
 */
export function startAutomationLoop(): void {
  const TICK_MS = 15_000;
  let lastRunAt = 0;

  const timer = setInterval(() => {
    void (async () => {
      try {
        const settings = await getRuntimeSettings();
        if (!settings.automationEnabled) {
          return;
        }
        const dueMs = settings.automationIntervalSec * 1000;
        if (Date.now() - lastRunAt < dueMs) {
          return;
        }
        lastRunAt = Date.now();
        const result = await runAutomationTick();
        if (result.action === "failed") {
          log.error({
            job: "automation",
            reason: result.reason,
            tick: "failed",
          });
        }
      } catch (error) {
        // Settings lookup failed — never crash the interval.
        log.error(
          error instanceof Error
            ? error
            : new Error("automation scheduler tick failed"),
        );
      }
    })();
  }, TICK_MS);
  timer.unref();

  log.info({ job: "automation", scheduled: "settings-driven" });
}
