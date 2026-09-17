import "server-only";

import { eq } from "drizzle-orm";

import { db } from "@/db";
import { strategyPlugins } from "@/db/schema/strategies";
import {
  appendPromotionRecord,
  getLatestPromotionRecord,
} from "@/lib/promotion-records";
import type { PromotionRecord } from "./promotion";
import { verifyPluginFixtures } from "./strategy-registry";

/**
 * Strategy plugin lifecycle: explicit DISABLE (halt) and REACTIVATE.
 *
 * Disable is the emergency brake:
 * - fail-safe ordering: the enabled flag is cleared BEFORE any lineage
 *   record is written, and the workflow checks the flag before every
 *   plugin run — a DB failure during the audit write leaves the plugin
 *   disabled, never half-disabled;
 * - auditable: an append-only HALTED promotion record snapshots the
 *   reason, operator, and prior head stage (HALTED is a legal transition
 *   from every stage in the promotion policy);
 * - idempotent: disabling an already-disabled plugin is a no-op.
 *
 * Reactivate is the controlled path back: the promotion policy only allows
 * HALTED → DRAFT, and this module refuses even that unless the plugin's
 * deterministic fixtures re-prove their recorded behavior in the isolated
 * runtime — a plugin that has drifted cannot quietly re-enter the
 * pipeline. The caller must then re-run whatever evaluation the target
 * stage requires through the normal promotion gate.
 */

export type DisableReason =
  | "operator"
  | "risk-breach"
  | "fixture-drift"
  | "under-review";

export type LifecycleOutcome =
  | { ok: true; record: PromotionRecord | null; stage: string }
  | {
      ok: false;
      reason:
        | "plugin-not-found"
        | "already-disabled"
        | "not-disabled"
        | "fixtures-drifted"
        | "not-loaded"
        | "gate-error";
    };

/** The real registry verifier; tests may inject a fake (DI, like the gate). */
export type FixturesVerifier = typeof verifyPluginFixtures;

async function readEnabled(pluginId: string): Promise<boolean | null> {
  const [row] = await db
    .select({ enabled: strategyPlugins.enabled })
    .from(strategyPlugins)
    .where(eq(strategyPlugins.pluginId, pluginId))
    .limit(1);
  return row?.enabled ?? null;
}

/**
 * Disable a plugin: execution stops at the workflow's pre-run check.
 * Idempotent; the returned record is the appended HALTED lineage entry
 * (null when the plugin was already disabled).
 */
export async function disableStrategyPlugin(input: {
  operator: string;
  pluginId: string;
  reason: DisableReason;
  reasonDetail?: string;
  verifyFixtures?: FixturesVerifier;
}): Promise<LifecycleOutcome> {
  const verifyFixtures = input.verifyFixtures ?? verifyPluginFixtures;
  const enabled = await readEnabled(input.pluginId);
  if (enabled === null) {
    return { ok: false, reason: "plugin-not-found" };
  }

  if (input.reason === "fixture-drift") {
    // The reason itself must be true: verify drift before claiming it.
    const configHash = await configHashOf(input.pluginId);
    if (!configHash) {
      return { ok: false, reason: "plugin-not-found" };
    }
    try {
      await verifyFixtures(input.pluginId, configHash);
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !(
          error.message.includes("not deterministic") ||
          error.message.includes("does not reproduce")
        )
      ) {
        // Refusing for a NON-drift reason while claiming drift would
        // falsify the audit trail — surface the real failure instead.
        return { ok: false, reason: "gate-error" };
      }
    }
  }

  if (!enabled) {
    return { ok: false, reason: "already-disabled" };
  }

  // (1) Fail-safe first: kill execution. If nothing after this line
  // commits, the plugin is still disabled.
  await db
    .update(strategyPlugins)
    .set({ enabled: false })
    .where(eq(strategyPlugins.pluginId, input.pluginId));

  // (2) Audit trail: append-only HALTED record carrying the prior evidence
  // ids PLUS the human context (who, why) as an appended annotation — the
  // annotation must survive even when a lineage head with evidence exists.
  const head = await getLatestPromotionRecord(input.pluginId);
  const annotation = `disable:${input.reason}:${input.operator}:${
    input.reasonDetail ?? ""
  }`.slice(0, 200);
  const halted: PromotionRecord = {
    configHash: head?.configHash ?? (await configHashOf(input.pluginId)) ?? "",
    dataSnapshotIds: [...(head?.dataSnapshotIds ?? []), annotation],
    evaluatedAt: new Date().toISOString(),
    metrics: head?.metrics ?? null,
    pluginId: input.pluginId,
    pluginVersion: head?.pluginVersion ?? "",
    policyHash: head?.policyHash ?? "",
    stage: "HALTED",
  };
  await appendPromotionRecord(halted);

  return { ok: true, record: halted, stage: head?.stage ?? "unknown" };
}

/**
 * Reactivate a disabled plugin. Gated on fresh fixture proof: the plugin
 * must re-prove its recorded behavior in the isolated runtime. Returns the
 * plugin re-enabled (flag true) — the caller advances its promotion stage
 * through the normal promotion gate from here.
 */
export async function reactivateStrategyPlugin(input: {
  operator: string;
  pluginId: string;
  verifyFixtures?: FixturesVerifier;
}): Promise<LifecycleOutcome> {
  const verifyFixtures = input.verifyFixtures ?? verifyPluginFixtures;
  const enabled = await readEnabled(input.pluginId);
  if (enabled === null) {
    return { ok: false, reason: "plugin-not-found" };
  }
  if (enabled) {
    return { ok: false, reason: "not-disabled" };
  }

  // Fresh determinism proof BEFORE re-enabling: drift refuses reactivation.
  const head = await getLatestPromotionRecord(input.pluginId);
  try {
    await verifyFixtures(
      input.pluginId,
      head?.configHash ?? "",
      head?.pluginVersion || undefined,
    );
  } catch (error) {
    if (!(error instanceof Error)) {
      return { ok: false, reason: "gate-error" };
    }
    if (
      error.message.includes("not deterministic") ||
      error.message.includes("does not reproduce")
    ) {
      return { ok: false, reason: "fixtures-drifted" };
    }
    if (error.message.includes("is not registered")) {
      // DB row exists but this process has no registry entry: the plugin
      // must be loaded/re-registered before it can re-enter the pipeline.
      return { ok: false, reason: "not-loaded" };
    }
    return { ok: false, reason: "gate-error" };
  }

  await db
    .update(strategyPlugins)
    .set({ enabled: true })
    .where(eq(strategyPlugins.pluginId, input.pluginId));

  // Append-only note of the reactivation (HALTED → DRAFT is the policy's
  // legal edge; the record records it happened and who did it). Routed
  // through appendPromotionRecord so the durable seq is allocated here
  // too — no write path may bypass seq allocation.
  await appendPromotionRecord({
    configHash: head?.configHash ?? "",
    dataSnapshotIds: [`reactivate:${input.operator}`.slice(0, 200)],
    evaluatedAt: new Date().toISOString(),
    metrics: null,
    pluginId: input.pluginId,
    pluginVersion: head?.pluginVersion ?? "",
    policyHash: head?.policyHash ?? "",
    stage: "DRAFT",
  });

  return { ok: true, record: head, stage: "DRAFT" };
}

async function configHashOf(pluginId: string): Promise<string | null> {
  const [row] = await db
    .select({ configHash: strategyPlugins.configHash })
    .from(strategyPlugins)
    .where(eq(strategyPlugins.pluginId, pluginId))
    .limit(1);
  return row?.configHash ?? null;
}

/** Convenience predicate for the workflow's pre-run check. */
export async function isStrategyPluginEnabled(
  pluginId: string,
): Promise<boolean> {
  const enabled = await readEnabled(pluginId);
  return enabled ?? false;
}
