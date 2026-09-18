import { eq } from "drizzle-orm";
import type { PromotionRecord } from "@/ai/capital-engine/promotion";
import {
  disableStrategyPlugin,
  isStrategyPluginEnabled,
} from "@/ai/capital-engine/strategy-lifecycle";
import { fetchTotalCapital } from "@/ai/tools/risk-tool";
import { db } from "@/db";
import { strategyPlugins } from "@/db/schema/strategies";
import { log } from "@/lib/evlog";
import { getLatestPromotionRecord } from "@/lib/promotion-records";
import {
  effectiveLossThreshold,
  evaluateRollbackTrigger,
  type RollbackTriggerReason,
  rollbackReasonDetail,
} from "@/lib/rollback-policy";
import { getRuntimeSettings } from "@/lib/runtime-settings";

/**
 * Automatic rollback monitor — the periodic half of the predeclared
 * rollback triggers (checklist §7). The TRIGGER SEMANTICS live in the pure
 * core (src/lib/rollback-policy.ts); this job only supplies data and
 * executes the audited kill switch.
 *
 * Every pass:
 *  1. reads the operator's predeclared thresholds (rollbackMaxLossPct /
 *     rollbackMaxDrawdownPct / canaryLossBudgetPct runtime settings; all
 *     null → no-op pass — automatic kills never run on inherited
 *     defaults);
 *  2. enumerates ENABLED plugins whose lineage head sits at CANARY or LIVE
 *     (the capital-bearing stages);
 *  3. evaluates the head record's metrics against the thresholds using the
 *     same total-capital denominator the risk gate uses;
 *  4. on breach, halts the plugin through disableStrategyPlugin with reason
 *     "risk-breach" — the SAME fail-safe, append-only, permissioned path an
 *     operator uses. No bespoke write path exists for automatic rollback:
 *     it lands in lineage exactly like a manual kill, and re-entry goes
 *     through the fixture-proofed reactivation + promotion gates.
 *
 * Idempotent: a breached plugin is disabled once; every later pass sees it
 * disabled (or its head at HALTED) and skips it. Breaches are also logged
 * loudly — an automatic kill the operator did not expect must be visible.
 */

export interface RollbackPassSummary {
  checked: number;
  halted: Array<{ pluginId: string; reasons: RollbackTriggerReason[] }>;
  /**
   * CANARY-stage plugins holding capital with NO loss budget armed —
   * surfaced so operators can close the gap the checklist §7 requires.
   */
  unbudgetedCanaries: string[];
  skipped: number;
}

const ROLLBACK_OPERATOR = "system:rollback-monitor";

/**
 * Injectable dependencies. Tests inject fakes (the established convention:
 * bun's mock.module is process-global across test files, so module mocks
 * poison other suites); production uses the real implementations below.
 */
export interface RollbackMonitorDeps {
  readCapital: () => Promise<number>;
  readHead: (pluginId: string) => Promise<PromotionRecord | null>;
  readThresholds: () => Promise<{
    canaryMaxLossPct: number | null;
    maxDrawdownPct: number | null;
    maxLossPct: number | null;
  }>;
  halt: (input: {
    operator: string;
    pluginId: string;
    reason: "risk-breach";
    reasonDetail?: string;
  }) => Promise<{ ok: boolean; reason?: string }>;
  isEnabled: (pluginId: string) => Promise<boolean>;
  listEnabledPlugins: () => Promise<Array<{ pluginId: string }>>;
}

function defaultDeps(): RollbackMonitorDeps {
  return {
    halt: (input) =>
      disableStrategyPlugin(input).then((outcome) =>
        outcome.ok ? { ok: true } : { ok: false, reason: outcome.reason },
      ),
    isEnabled: isStrategyPluginEnabled,
    listEnabledPlugins: async () =>
      db
        .select({ pluginId: strategyPlugins.pluginId })
        .from(strategyPlugins)
        .where(eq(strategyPlugins.enabled, true)),
    readCapital: fetchTotalCapital,
    readHead: getLatestPromotionRecord,
    readThresholds: async () => {
      const settings = await getRuntimeSettings();
      return {
        canaryMaxLossPct: settings.canaryLossBudgetPct,
        maxDrawdownPct: settings.rollbackMaxDrawdownPct,
        maxLossPct: settings.rollbackMaxLossPct,
      };
    },
  };
}

export async function runStrategyRollbackMonitor(
  depsInput?: Partial<RollbackMonitorDeps>,
): Promise<RollbackPassSummary> {
  const deps: RollbackMonitorDeps = { ...defaultDeps(), ...depsInput };
  const summary: RollbackPassSummary = {
    checked: 0,
    halted: [],
    skipped: 0,
    unbudgetedCanaries: [],
  };

  const [thresholds, capital] = await Promise.all([
    deps.readThresholds(),
    deps.readCapital(),
  ]);

  if (
    thresholds.maxDrawdownPct === null &&
    thresholds.maxLossPct === null &&
    thresholds.canaryMaxLossPct === null
  ) {
    // Nothing predeclared: the monitor does not even enumerate plugins.
    log.info({
      job: "strategy-rollback",
      skipped: "no-thresholds-predeclared",
    });
    return summary;
  }

  // The monitor only ever HALTS: enabled + capital-bearing head stage.
  // Disabling goes through the lifecycle kill switch, which appends its
  // own HALTED record — so a plugin rolled back in pass N reads as
  // disabled (and its head as HALTED) in pass N+1 and is skipped.
  const candidates = await deps.listEnabledPlugins();

  // Each candidate is evaluated and (if needed) halted independently; the
  // reads and the idempotent kill run concurrently per candidate.
  await Promise.all(
    candidates.map(async ({ pluginId }) => {
      summary.checked += 1;

      const head = await deps.readHead(pluginId);
      const lossThreshold = effectiveLossThreshold(head?.stage ?? "", {
        canaryMaxLossPct: thresholds.canaryMaxLossPct ?? null,
        maxLossPct: thresholds.maxLossPct,
      });
      const evaluation = evaluateRollbackTrigger({
        capital,
        headStage: head?.stage ?? "",
        metrics: head?.metrics ?? null,
        thresholds,
      });

      if (!evaluation.trigger) {
        // A canary holding capital with the canary loss budget NOT armed
        // is exactly the state checklist §7 exists to prevent — surface
        // it loudly (even when a looser global cap happens to cover it).
        if (
          head?.stage === "CANARY" &&
          (thresholds.canaryMaxLossPct ?? null) === null
        ) {
          summary.unbudgetedCanaries.push(pluginId);
          log.warn({
            job: "strategy-rollback",
            pluginId,
            warning: "canary_loss_budget_not_armed",
          });
        }
        summary.skipped += 1;
        return;
      }

      // Belt and braces: re-check enablement at the moment of the kill — a
      // concurrent operator disable between enumeration and now must not be
      // second-guessed (disableStrategyPlugin is idempotent anyway, but the
      // audit trail should not carry a redundant system kill).
      if (!(await deps.isEnabled(pluginId))) {
        summary.skipped += 1;
        return;
      }

      if (!head?.metrics) {
        // Unreachable by construction of the trigger; narrows the type.
        summary.skipped += 1;
        return;
      }

      const detail = rollbackReasonDetail(
        evaluation.reasons,
        head.metrics,
        lossThreshold,
      );
      const outcome = await deps.halt({
        operator: ROLLBACK_OPERATOR,
        pluginId,
        reason: "risk-breach",
        reasonDetail: detail.slice(0, 200),
      });

      if (outcome.ok) {
        summary.halted.push({ pluginId, reasons: evaluation.reasons });
        log.error({
          audit: "strategy_auto_rollback",
          job: "strategy-rollback",
          pluginId,
          reasons: evaluation.reasons,
          trigger: detail,
        });
      } else {
        // E.g. an operator raced us to the disable — log, never throw: the
        // next pass reconciles.
        log.warn({
          job: "strategy-rollback",
          outcome: outcome.reason,
          pluginId,
          trigger: detail,
        });
      }
    }),
  );

  log.info({
    checked: summary.checked,
    halted: summary.halted.length,
    job: "strategy-rollback",
  });
  return summary;
}

/**
 * Evaluate WITHOUT executing — the manual-trigger route reports what the
 * monitor sees so an operator can verify thresholds before arming them.
 */
export async function previewStrategyRollbacks(
  depsInput?: Partial<RollbackMonitorDeps>,
): Promise<
  Array<{
    head: PromotionRecord | null;
    pluginId: string;
    result: ReturnType<typeof evaluateRollbackTrigger>;
  }>
> {
  const deps: RollbackMonitorDeps = { ...defaultDeps(), ...depsInput };
  const [thresholds, capital, candidates] = await Promise.all([
    deps.readThresholds(),
    deps.readCapital(),
    deps.listEnabledPlugins(),
  ]);

  // Promise.all preserves input order, so returned previews stay in the
  // same candidate order as the sequential version.
  return Promise.all(
    candidates.map(async ({ pluginId }) => {
      const head = await deps.readHead(pluginId);
      return {
        head,
        pluginId,
        result: evaluateRollbackTrigger({
          capital,
          headStage: head?.stage ?? "",
          metrics: head?.metrics ?? null,
          thresholds,
        }),
      };
    }),
  );
}
