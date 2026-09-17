import "server-only";

import {
  type StrategyPluginManifest,
  validateStrategyPluginManifest,
} from "./plugin";
import { advancePromotion, type PromotionRecord } from "./promotion";
import { verifyPluginFixtures } from "./strategy-registry";

/**
 * Promotion gate — the only sanctioned way to advance a strategy plugin's
 * promotion stage. Every stage transition must, in order:
 *
 * 1. carry a well-formed manifest (pluginId + configHash identity);
 * 2. pass `verifyPluginFixtures` — the plugin's deterministic fixtures are
 *    replayed through the isolated worker realm and must reproduce the
 *    registration-time recordings byte-for-byte (drift, divergence, or a
 *    version mismatch between the record and the registered manifest
 *    refuses the advance);
 * 3. be the plugin's CURRENT lineage head, read through the required
 *    DB-backed reader — a stale record means the operator acted on lineage
 *    someone else already advanced (concurrent gate runs for the same
 *    plugin are serialized in-process so the check-then-append is atomic
 *    per plugin);
 * 4. satisfy the immutable transition policy (`advancePromotion`: legal
 *    stage edge, complete evaluation metadata);
 * 5. produce a caller-persisted append-only `PromotionRecord` (the hook
 *    form keeps this module db-free, mirroring strategy-registry.ts).
 *
 * Returning the verified manifest lets callers stamp the exact verified
 * identity (pluginId + configHash + pluginVersion) into the persisted
 * record, so lineage rows cannot drift from what the gate actually proved.
 */

/**
 * Per-plugin mutexes: concurrent stage advances for one plugin run their
 * lineage-check + policy + persist section one at a time, so two operators
 * (or a retry racing the first request) cannot both act on the same head.
 * Different plugins advance in parallel; cross-process serialization, if
 * ever needed, belongs in the DB layer (e.g. a head row with a unique
 * constraint), not here.
 */
const gateLocks = new Map<string, Promise<unknown>>();

function withPluginLock<T>(pluginId: string, fn: () => Promise<T>): Promise<T> {
  const previous = gateLocks.get(pluginId) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(fn);
  gateLocks.set(
    pluginId,
    next.catch(() => undefined),
  );
  return next;
}

export interface PromotionGateInput {
  /** The plugin identity the record claims. */
  manifest: unknown;
  /**
   * The append-only record to advance. The gate refuses to advance it
   * unless it IS the plugin's current lineage head — a stale record means
   * the operator read lineage, someone else advanced it, and this request
   * is acting on outdated state.
   */
  record: PromotionRecord;
  /** Persist the advanced record (e.g. appendPromotionRecord). A returned
   * id (or any value) is accepted and forwarded to the caller untouched. */
  persistRecord: (record: PromotionRecord) => Promise<unknown>;
  /**
   * DB-backed lineage reader (getLatestPromotionRecord): returns the
   * plugin's current head record, or null when no record exists yet. The
   * gate cannot verify "latest" without it — this is intentionally
   * required so the gate can never be called with lineage enforcement
   * silently missing.
   */
  readLatestRecord: (pluginId: string) => Promise<PromotionRecord | null>;
  /** The promotion stage being requested. */
  toStage: PromotionRecord["stage"];
}

export interface PromotionGateResult {
  advanced: PromotionRecord;
  manifest: StrategyPluginManifest;
}

export async function advancePromotionGate(
  input: PromotionGateInput,
): Promise<PromotionGateResult> {
  // (1) Identity: the record must claim a well-formed plugin identity.
  // Fixtures verification (step 2) runs OUTSIDE the per-plugin lock so a
  // slow replay never blocks another operator's lineage read for a
  // different plugin; identity validation needs no shared state.
  const manifest = validateStrategyPluginManifest(input.manifest);
  return withPluginLock(manifest.pluginId, () =>
    advancePromotionGateLocked(input, manifest),
  );
}

async function advancePromotionGateLocked(
  input: PromotionGateInput,
  manifest: StrategyPluginManifest,
): Promise<PromotionGateResult> {
  // (2) Determinism + version binding: refuses unregistered plugins,
  // drifted behavior, and record/manifest version mismatches.
  await verifyPluginFixtures(
    manifest.pluginId,
    manifest.configHash,
    input.record.pluginVersion,
  );

  // (3) Lineage head: the record must be the plugin's current one.
  const latest = await input.readLatestRecord(manifest.pluginId);
  if (latest === null) {
    throw new Error(
      `plugin ${manifest.pluginId} has no promotion lineage; seed a DRAFT record before advancing`,
    );
  }
  if (latest.stage !== input.record.stage) {
    throw new Error(
      `stale promotion record: lineage head is at ${latest.stage}, the submitted record claims ${input.record.stage}; re-read lineage and retry`,
    );
  }

  // (4) Policy: legal transition edge + complete evaluation metadata.
  // Note the gate deliberately does NOT fill dataSnapshotIds/policyHash —
  // callers must already have evaluated the plugin for this stage; the gate
  // only refuses to advance incomplete records.
  const advanced = advancePromotion(input.record, input.toStage);

  // (5) Lineage: caller persists the append-only record.
  await input.persistRecord(advanced);

  return { advanced, manifest };
}
