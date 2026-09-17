import "server-only";

import { eq } from "drizzle-orm";

import { db } from "@/db";
import { strategyPlugins } from "@/db/schema/strategies";
import {
  appendPromotionRecord,
  getLatestPromotionRecord,
  registerStrategyPlugin,
} from "@/lib/promotion-records";
import {
  CONSENSUS_PLUGIN_FIXTURES,
  CONSENSUS_PLUGIN_MANIFEST,
  CONSENSUS_PLUGIN_SOURCE,
} from "./plugin-runtime";
import type { PromotionRecord } from "./promotion";
import {
  advancePromotionGate,
  type PromotionGateResult,
} from "./promotion-gate";
import { registerStrategyPluginSource } from "./strategy-registry";

/**
 * Operator-side plugin promotion: loads the plugin's manifest from the DB
 * (lineage is keyed to persisted plugins, not to whatever a request claims),
 * bootstraps built-in plugin registration from the server-owned source, and
 * drives `advancePromotionGate` with the real lineage reader/writer.
 *
 * The stage advance itself is refused unless the submitted record is the
 * plugin's CURRENT lineage head (stale/double-submit protection) and the
 * plugin's fixtures re-prove determinism in the isolated runtime — the gate
 * owns both; this module only owns DB access and identity resolution.
 */

export type PromotePluginReason =
  | /** Manifest/record identity failed validation. */ "invalid-manifest"
  /** No strategy_plugins row for the requested id. */
  | "plugin-not-found"
  /** DB manifest exists but this process has no registry entry. */
  | "not-loaded"
  /** No DRAFT-or-later record exists yet. */
  | "no-lineage"
  /** Requested stage edge is not allowed by the promotion policy. */
  | "invalid-transition"
  /** Record lacks dataSnapshotIds/policyHash evaluation evidence. */
  | "incomplete-record"
  /** Lineage head moved since the operator read it (retry with fresh data). */
  | "stale-head"
  /** Anything else (fixture failure, DB error, …) — see logs. */
  | "gate-error";

export type PromotePluginOutcome =
  | { ok: true; result: PromotionGateResult }
  | { ok: false; reason: PromotePluginReason };

/**
 * The consensus plugin's source is server-owned (never request data), so the
 * route can bootstrap its registry entry from the built-in fixtures before
 * the gate's fixture verification runs. Third-party plugins will instead be
 * registered at deploy time by their loader — this bootstrap is deliberately
 * limited to the built-in identity and ignores request data entirely.
 */
async function ensureBuiltinRegistration(): Promise<void> {
  await registerStrategyPluginSource({
    fixtures: CONSENSUS_PLUGIN_FIXTURES,
    manifest: CONSENSUS_PLUGIN_MANIFEST,
    onFirstRegister: (manifest) => registerStrategyPlugin(manifest),
    source: CONSENSUS_PLUGIN_SOURCE,
  });
}

/** Exported for tests: maps gate/DB failures to operator-facing reasons. */
export function reasonFromGateError(error: unknown): PromotePluginReason {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("is not registered")) return "not-loaded";
  if (message.includes("no promotion lineage")) return "no-lineage";
  if (message.includes("stale promotion record")) return "stale-head";
  if (message.includes("Invalid promotion transition")) {
    return "invalid-transition";
  }
  if (message.includes("missing immutable evaluation metadata")) {
    return "incomplete-record";
  }
  if (
    message.includes("does not match the requested") ||
    message.includes("not deterministic") ||
    message.includes("does not reproduce") ||
    message.includes("records strategyVersion")
  ) {
    return "invalid-manifest";
  }
  // Durable double-append loss: another replica won the UNIQUE
  // (plugin_id, seq) race while this run was in flight — the lineage
  // head moved, so this advance is stale by definition. (The in-process
  // mutex can't see cross-process races; this violation is the DB
  // catching exactly the case the mutex cannot.)
  if (
    message.includes("strategy_promotions_plugin_seq_uidx") ||
    (error as { code?: string } | null)?.code === "23505"
  ) {
    return "stale-head";
  }
  return "gate-error";
}

export async function promotePlugin(input: {
  /** The plugin identity being promoted (from the URL, not the body). */
  pluginId: string;
  /** The operator-submitted record to advance. */
  record: PromotionRecord;
  /** The promotion stage being requested. */
  toStage: PromotionRecord["stage"];
}): Promise<PromotePluginOutcome> {
  // (1) Identity from the DB, never from the request body.
  const [row] = await db
    .select({
      configHash: strategyPlugins.configHash,
      pluginVersion: strategyPlugins.pluginVersion,
    })
    .from(strategyPlugins)
    .where(eq(strategyPlugins.pluginId, input.pluginId))
    .limit(1);

  if (!row) {
    return { ok: false, reason: "plugin-not-found" };
  }

  // (2) Built-in plugins may self-register (server-owned source) so the
  // gate's fixture verification has a registry entry to check.
  await ensureBuiltinRegistration();

  // (3) Drive the gate with the real lineage reader/writer.
  try {
    const result = await advancePromotionGate({
      manifest: {
        capabilities: ["proposal"],
        configHash: row.configHash,
        evidenceRequirements: ["signal", "technicals"],
        pluginId: input.pluginId,
        pluginVersion: row.pluginVersion,
      },
      persistRecord: appendPromotionRecord,
      readLatestRecord: getLatestPromotionRecord,
      record: input.record,
      toStage: input.toStage,
    });
    return { ok: true, result };
  } catch (error) {
    return { ok: false, reason: reasonFromGateError(error) };
  }
}
