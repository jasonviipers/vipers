import { eq } from "drizzle-orm";
import { z } from "zod";

import {
  ACTIVE_BROKER_DEFAULT,
  type BrokerId,
  isKnownBroker,
} from "@/channels/broker/registry";
import { db } from "@/db";
import { runtimeSettings } from "@/db/schema/trading";
import { syncBrokerBalanceToLedger } from "@/lib/broker-balance";
import { isActiveBrokerSwitch } from "@/lib/capital-basis";
import { log } from "@/lib/evlog";

/**
 * Server-owned operator settings that the pipeline and API routes enforce.
 *
 * The /settings sliders for consensus quorum, daily-loss cap, max open
 * positions and debug mode write here (via PUT /api/settings/runtime) and
 * the ENFORCERS read from here:
 *
 *   activeBrokerId     → execution routing + capital re-anchor (balance sync)
 *   automationEnabled     → automation tick gate     (automation job)
 *   automationIntervalSec → automation pass cadence  (automation job)
 *   consensusQuorum       → consensus step threshold (workflow)
 *   maxDailyLossPct       → risk gate daily-loss cap (risk gate)
 *   maxOpenPositions      → risk gate open-positions cap (risk gate)
 *   debugMode             → events feed detail level (events route)
 *
 * Display-only preferences (timezone, animations, notifications, etc.)
 * remain client-side in terminal-settings.
 */

export interface RuntimeSettings {
  /**
   * Active broker id ("okx" | "alpaca"). Orders route through this broker
   * (see src/channels/broker/registry.ts). Defaults to OKX so existing
   * deployments keep routing unchanged.
   */
  activeBrokerId: BrokerId;
  automationEnabled: boolean;
  /** Seconds between automatic full-pipeline passes (bounded 60–3600). */
  automationIntervalSec: number;
  /**
   * CANARY loss budget (percent of total capital). Tightens the automatic
   * rollback loss threshold for CANARY-stage lineage heads (the effective
   * threshold is the tighter of this and rollbackMaxLossPct); ignored for
   * LIVE. Null = no canary-specific budget is predeclared.
   */
  canaryLossBudgetPct: number | null;
  /**
   * CANARY per-order allocation cap (percent of book) enforced by the risk
   * gate for plugins whose lineage head is at CANARY. Null = not armed —
   * new risk for canary plugins is then REFUSED (fail closed) rather than
   * allowed at live sizing, because canary capital must be explicitly
   * bounded before it trades.
   */
  canaryMaxAllocationPct: number | null;
  consensusQuorum: number;
  debugMode: boolean;
  /** Seconds; drives the agent online-window (interval × 3, bounded). */
  heartbeatInterval: number;
  maxDailyLossPct: number;
  maxOpenPositions: number;
  /**
   * Auto-rollback thresholds (percent) for capital-bearing plugins; null
   * disables the trigger (no threshold is predeclared). Evaluated against
   * promotion-record metrics by the strategy-rollback monitor.
   */
  rollbackMaxDrawdownPct: number | null;
  rollbackMaxLossPct: number | null;
  /** Default LLM provider for the agent fleet (validated upstream). */
  defaultLlmProvider: string;
}

const RUNTIME_SETTINGS_DEFAULTS: RuntimeSettings = {
  activeBrokerId: ACTIVE_BROKER_DEFAULT,
  automationEnabled: true,
  automationIntervalSec: 300,
  canaryLossBudgetPct: null,
  canaryMaxAllocationPct: null,
  consensusQuorum: 50,
  debugMode: false,
  // OLLAMA is the operator's default fleet provider; each agent additionally
  // gets its own role-appropriate Ollama model via the recommended presets
  // (lib/agent-model-presets.ts) unless explicitly overridden in /settings.
  defaultLlmProvider: "OLLAMA",
  heartbeatInterval: 30,
  maxDailyLossPct: 3,
  maxOpenPositions: 10,
  rollbackMaxDrawdownPct: null,
  rollbackMaxLossPct: null,
};

export const runtimeSettingsSchema = z.object({
  activeBrokerId: z.enum(["okx", "alpaca"]).optional(),
  automationEnabled: z.boolean().optional(),
  automationIntervalSec: z.number().int().min(60).max(3600).optional(),
  canaryLossBudgetPct: z.number().int().min(1).max(100).nullable().optional(),
  canaryMaxAllocationPct: z
    .number()
    .int()
    .min(1)
    .max(100)
    .nullable()
    .optional(),
  consensusQuorum: z.number().int().min(30).max(100).optional(),
  debugMode: z.boolean().optional(),
  defaultLlmProvider: z
    .enum(["OPENAI", "ANTHROPIC", "GOOGLE", "XAI", "DEEPSEEK", "OLLAMA"])
    .optional(),
  heartbeatInterval: z.number().int().min(5).max(120).optional(),
  maxDailyLossPct: z.number().int().min(1).max(20).optional(),
  maxOpenPositions: z.number().int().min(1).max(50).optional(),
  rollbackMaxDrawdownPct: z
    .number()
    .int()
    .min(1)
    .max(100)
    .nullable()
    .optional(),
  rollbackMaxLossPct: z.number().int().min(1).max(100).nullable().optional(),
});

/** Fetch the singleton row, creating it with defaults on first access. */
export async function getRuntimeSettings(): Promise<RuntimeSettings> {
  const [row] = await db
    .select()
    .from(runtimeSettings)
    .where(eq(runtimeSettings.id, "global"))
    .limit(1);

  if (row) {
    return {
      activeBrokerId: isKnownBroker(row.activeBrokerId)
        ? row.activeBrokerId
        : ACTIVE_BROKER_DEFAULT,
      automationEnabled:
        row.automationEnabled ?? RUNTIME_SETTINGS_DEFAULTS.automationEnabled,
      automationIntervalSec:
        row.automationIntervalSec ??
        RUNTIME_SETTINGS_DEFAULTS.automationIntervalSec,
      canaryLossBudgetPct: row.canaryLossBudgetPct ?? null,
      canaryMaxAllocationPct: row.canaryMaxAllocationPct ?? null,
      consensusQuorum:
        row.consensusQuorum ?? RUNTIME_SETTINGS_DEFAULTS.consensusQuorum,
      debugMode: row.debugMode,
      defaultLlmProvider:
        row.defaultLlmProvider ?? RUNTIME_SETTINGS_DEFAULTS.defaultLlmProvider,
      heartbeatInterval:
        row.heartbeatInterval ?? RUNTIME_SETTINGS_DEFAULTS.heartbeatInterval,
      maxDailyLossPct:
        row.maxDailyLossPct ?? RUNTIME_SETTINGS_DEFAULTS.maxDailyLossPct,
      maxOpenPositions:
        row.maxOpenPositions ?? RUNTIME_SETTINGS_DEFAULTS.maxOpenPositions,
      rollbackMaxDrawdownPct: row.rollbackMaxDrawdownPct ?? null,
      rollbackMaxLossPct: row.rollbackMaxLossPct ?? null,
    };
  }

  // First access (or a manually-cleared row): create the singleton.
  try {
    await db
      .insert(runtimeSettings)
      .values({ id: "global" })
      .onConflictDoNothing({ target: runtimeSettings.id });
  } catch {
    // A concurrent writer may have inserted first — either way the row
    // exists now; fall through to defaults.
  }
  return RUNTIME_SETTINGS_DEFAULTS;
}

/**
 * Reconcile the capital ledger with the ACTIVE broker's account equity.
 * Awaited by updateRuntimeSettings so the settings response (and the UI
 * refetch it triggers) observes the refreshed snapshot; a failed probe is
 * logged and retried by the next portfolio rollup — it never fails the
 * settings write.
 */
async function resyncCapitalToLedger(brokerId: BrokerId): Promise<void> {
  try {
    const result = await syncBrokerBalanceToLedger(brokerId);
    log.info({
      action: "broker_switch_capital_resync",
      brokerId,
      delta: result.delta,
      equityUsd: result.equityUsd,
      totalCapital: result.totalCapital,
    });
  } catch (error) {
    log.warn({
      action: "broker_switch_capital_resync_failed",
      brokerId,
      detail: error instanceof Error ? error.message : "unknown error",
    });
  }
}

/** Apply a validated partial patch and return the effective settings. */
export async function updateRuntimeSettings(
  patch: Partial<RuntimeSettings>,
): Promise<RuntimeSettings> {
  const current = await getRuntimeSettings();

  // A broker SWITCH re-anchors the capital ledger to the new broker's
  // account equity (src/lib/broker-balance.ts), so the dashboard, risk
  // gate and rollback monitor immediately reflect the selected provider's
  // capital. Awaited AFTER the settings row lands so the settings response
  // and the refetch it triggers see the refreshed snapshot; a failed
  // resync never fails the settings write.
  const switchedBrokerId = isActiveBrokerSwitch(
    current.activeBrokerId,
    patch.activeBrokerId,
  )
    ? patch.activeBrokerId
    : null;

  const next: RuntimeSettings = { ...current, ...patch };

  await db
    .insert(runtimeSettings)
    .values({
      activeBrokerId: next.activeBrokerId,
      automationEnabled: next.automationEnabled,
      automationIntervalSec: next.automationIntervalSec,
      canaryLossBudgetPct: next.canaryLossBudgetPct,
      canaryMaxAllocationPct: next.canaryMaxAllocationPct,
      consensusQuorum: next.consensusQuorum,
      debugMode: next.debugMode,
      defaultLlmProvider: next.defaultLlmProvider,
      heartbeatInterval: next.heartbeatInterval,
      id: "global",
      maxDailyLossPct: next.maxDailyLossPct,
      maxOpenPositions: next.maxOpenPositions,
      rollbackMaxDrawdownPct: next.rollbackMaxDrawdownPct,
      rollbackMaxLossPct: next.rollbackMaxLossPct,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: runtimeSettings.id,
      set: {
        activeBrokerId: next.activeBrokerId,
        automationEnabled: next.automationEnabled,
        automationIntervalSec: next.automationIntervalSec,
        canaryLossBudgetPct: next.canaryLossBudgetPct,
        canaryMaxAllocationPct: next.canaryMaxAllocationPct,
        consensusQuorum: next.consensusQuorum,
        debugMode: next.debugMode,
        defaultLlmProvider: next.defaultLlmProvider,
        heartbeatInterval: next.heartbeatInterval,
        maxDailyLossPct: next.maxDailyLossPct,
        maxOpenPositions: next.maxOpenPositions,
        rollbackMaxDrawdownPct: next.rollbackMaxDrawdownPct,
        rollbackMaxLossPct: next.rollbackMaxLossPct,
        updatedAt: new Date(),
      },
    });

  if (switchedBrokerId) {
    await resyncCapitalToLedger(switchedBrokerId);
  }

  return next;
}

/**
 * Canonical sha256 over the effective runtime settings — the
 * settingsHash stamped into decision metadata, so an audit can show which
 * operator controls (quorum, loss caps, provider, …) were in force when a
 * decision was made.
 */
export async function hashRuntimeSettings(): Promise<string> {
  const [{ createHash }, { canonicalise }, settings] = await Promise.all([
    import("node:crypto"),
    import("@/ai/capital-engine/canonical-json"),
    getRuntimeSettings(),
  ]);
  return createHash("sha256").update(canonicalise(settings)).digest("hex");
}
