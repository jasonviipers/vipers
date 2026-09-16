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
    pluginId: manifest.pluginId,
    pluginVersion: manifest.pluginVersion,
  });
}

/**
 * Append a promotion record. Existing records are never updated, so the
 * complete promotion history remains auditable.
 */
export async function appendPromotionRecord(
  record: PromotionRecord,
): Promise<string> {
  const inserted = await db
    .insert(strategyPromotions)
    .values({
      configHash: record.configHash,
      dataSnapshotIds: record.dataSnapshotIds,
      metrics: null,
      pluginId: record.pluginId,
      pluginVersion: record.pluginVersion,
      policyHash: record.policyHash,
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
    .orderBy(desc(strategyPromotions.createdAt))
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
    pluginId: row.pluginId,
    pluginVersion: row.pluginVersion,
    policyHash: row.policyHash,
    stage: row.stage,
  };
}
