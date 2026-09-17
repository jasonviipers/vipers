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
 * 3. satisfy the immutable transition policy (`advancePromotion`: legal
 *    stage edge, complete evaluation metadata);
 * 4. produce a caller-persisted append-only `PromotionRecord` (the hook
 *    form keeps this module db-free, mirroring strategy-registry.ts).
 *
 * Returning the verified manifest lets callers stamp the exact verified
 * identity (pluginId + configHash + pluginVersion) into the persisted
 * record, so lineage rows cannot drift from what the gate actually proved.
 */

export interface PromotionGateInput {
  /** The plugin identity the record claims. */
  manifest: unknown;
  /** The append-only record to advance (must be the latest for this plugin). */
  record: PromotionRecord;
  /** Persist the advanced record (e.g. appendPromotionRecord). */
  persistRecord: (record: PromotionRecord) => Promise<void>;
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
  const manifest = validateStrategyPluginManifest(input.manifest);

  // (2) Determinism + version binding: refuses unregistered plugins,
  // drifted behavior, and record/manifest version mismatches.
  await verifyPluginFixtures(
    manifest.pluginId,
    manifest.configHash,
    input.record.pluginVersion,
  );

  // (3) Policy: legal transition edge + complete evaluation metadata.
  // Note the gate deliberately does NOT fill dataSnapshotIds/policyHash —
  // callers must already have evaluated the plugin for this stage; the gate
  // only refuses to advance incomplete records.
  const advanced = advancePromotion(input.record, input.toStage);

  // (4) Lineage: caller persists the append-only record.
  await input.persistRecord(advanced);

  return { advanced, manifest };
}
