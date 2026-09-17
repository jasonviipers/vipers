import { desc, eq } from "drizzle-orm";

import type { StrategyPluginManifest } from "@/ai/capital-engine/plugin";
import type { PromotionRecord } from "@/ai/capital-engine/promotion";
import { db } from "@/db";
import { strategyPlugins, strategyPromotions } from "@/db/schema/strategies";

export async function registerStrategyPlugin(
  manifest: StrategyPluginManifest,
): Promise<void> {
  const [existing] = await db
    .select({
      configHash: strategyPlugins.configHash,
      pluginVersion: strategyPlugins.pluginVersion,
    })
    .from(strategyPlugins)
    .where(eq(strategyPlugins.pluginId, manifest.pluginId))
    .limit(1);

  if (existing) {
    if (
      existing.configHash !== manifest.configHash ||
      existing.pluginVersion !== manifest.pluginVersion
    ) {
      throw new Error(
        `Strategy plugin ${manifest.pluginId} is immutable; register a new plugin version instead`,
      );
    }
    return;
  }

  await db.insert(strategyPlugins).values({
    capabilities: manifest.capabilities,
    configHash: manifest.configHash,
    evidenceRequirements: manifest.evidenceRequirements,
    // Fail-safe default: a plugin is live-capable only after an operator
    // explicitly enables it (see strategy-lifecycle.ts).
    enabled: false,
    pluginId: manifest.pluginId,
    pluginVersion: manifest.pluginVersion,
  });
}

/**
 * Append a promotion record. Existing records are never updated, so the
 * complete promotion history remains auditable.
 *
 * Durable double-append protection: the per-plugin monotonic `seq` is
 * allocated as head.seq + 1 inside this insert. The UNIQUE (plugin_id,
 * seq) index (see strategy_promotions in the schema) makes a concurrent
 * append from another process/replica impossible to commit twice — the
 * loser's insert fails with a unique violation, which callers (the
 * promotion gate's operator surface) map to a stale-lineage refusal.
 */
export async function appendPromotionRecord(
  record: PromotionRecord,
): Promise<string> {
  const [head] = await db
    .select({ seq: strategyPromotions.seq })
    .from(strategyPromotions)
    .where(eq(strategyPromotions.pluginId, record.pluginId))
    .orderBy(desc(strategyPromotions.seq))
    .limit(1);
  const inserted = await db
    .insert(strategyPromotions)
    .values({
      configHash: record.configHash,
      dataSnapshotIds: record.dataSnapshotIds,
      metrics: record.metrics,
      pluginId: record.pluginId,
      pluginVersion: record.pluginVersion,
      policyHash: record.policyHash,
      seq: (head?.seq ?? 0) + 1,
      stage: record.stage,
    })
    .returning({ id: strategyPromotions.id });
  return inserted[0].id;
}

export async function getLatestPromotionRecord(
  pluginId: string,
): Promise<PromotionRecord | null> {
  const [row] = await db
    .select()
    .from(strategyPromotions)
    .where(eq(strategyPromotions.pluginId, pluginId))
    // seq is the authoritative lineage order (createdAt ties when two
    // records land in the same transaction clock tick — exactly the race
    // this ordering exists to resolve).
    .orderBy(desc(strategyPromotions.seq))
    .limit(1);
  if (!row) {
    return null;
  }
  return {
    configHash: row.configHash,
    dataSnapshotIds: Array.isArray(row.dataSnapshotIds)
      ? row.dataSnapshotIds.map(String)
      : [],
    evaluatedAt: row.createdAt.toISOString(),
    metrics:
      row.metrics && typeof row.metrics === "object"
        ? (row.metrics as PromotionRecord["metrics"])
        : null,
    pluginId: row.pluginId,
    pluginVersion: row.pluginVersion,
    policyHash: row.policyHash,
    stage: row.stage,
  };
}
