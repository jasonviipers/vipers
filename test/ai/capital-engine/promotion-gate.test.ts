import { describe, expect, it } from "bun:test";
import { CONSENSUS_PLUGIN_MANIFEST } from "@/ai/capital-engine/plugin-runtime";
import {
  advancePromotion,
  type PromotionRecord,
} from "@/ai/capital-engine/promotion";
import { advancePromotionGate } from "@/ai/capital-engine/promotion-gate";
import { registerStrategyPluginSource } from "@/ai/capital-engine/strategy-registry";

/**
 * Promotion gate: no plugin advances a promotion stage without its
 * deterministic fixtures re-proving determinism in the isolated runtime,
 * the record's version bound to the registered manifest version, and the
 * submitted record being the plugin's CURRENT lineage head.
 */

const manifest = CONSENSUS_PLUGIN_MANIFEST;

function recordFor(manifestForRecord: {
  configHash: string;
  pluginId: string;
  pluginVersion: string;
}): PromotionRecord {
  return {
    configHash: manifestForRecord.configHash,
    dataSnapshotIds: ["data-snapshot-1"],
    evaluatedAt: new Date().toISOString(),
    pluginId: manifestForRecord.pluginId,
    pluginVersion: manifestForRecord.pluginVersion,
    policyHash: "p".repeat(64),
    stage: "DRAFT",
  };
}

/** Registered passthrough plugin on a distinct identity for happy-path tests. */
async function registerTestPlugin() {
  const pluginId = "gate-test-v1";
  const testManifest = {
    ...manifest,
    configHash: "a".repeat(64),
    pluginId,
    pluginVersion: pluginId,
  };
  const candidate = {
    asset: "BTC",
    confidence: 0.8,
    direction: "LONG",
    evidence: {
      signalFetchedAt: 1,
      signalId: "signal-1",
      technicalsFetchedAt: 2,
    },
    proposalId: "proposal-1",
    reasoning: "fixture evidence supports the proposal",
    signalId: "signal-1",
    strategyVersion: pluginId,
  };
  await registerStrategyPluginSource({
    fixtures: [
      {
        evidence: {
          asset: "BTC",
          signalFetchedAt: 1,
          signalId: "signal-1",
          technicalsFetchedAt: 2,
        },
        expectedDecision: candidate,
        input: { candidate },
        name: "passthrough",
      },
    ],
    manifest: testManifest,
    source: "async ({ candidate }) => candidate",
  });
  return testManifest;
}

describe("promotion gate", () => {
  /** Lineage reader backed by an in-memory head (mutate to simulate races). */
  function makeLineage() {
    const heads = new Map<string, PromotionRecord>();
    return {
      head: (pluginId: string) => Promise.resolve(heads.get(pluginId) ?? null),
      seed: (record: PromotionRecord) => heads.set(record.pluginId, record),
    };
  }

  it("advances a verified plugin and appends the record with verified identity", async () => {
    const testManifest = await registerTestPlugin();
    const lineage = makeLineage();
    const persisted: PromotionRecord[] = [];
    const record = recordFor(testManifest);
    lineage.seed(record);

    const result = await advancePromotionGate({
      manifest: testManifest,
      persistRecord: async (r) => {
        persisted.push(r);
        lineage.seed(r); // simulate the DB head moving on append
      },
      readLatestRecord: lineage.head,
      record,
      toStage: "BACKTEST",
    });

    expect(result.advanced.stage).toBe("BACKTEST");
    expect(persisted).toHaveLength(1);
    // The gate echoes the exact verified identity for lineage stamping.
    expect(result.manifest.pluginId).toBe(testManifest.pluginId);
    expect(result.manifest.pluginVersion).toBe(testManifest.pluginVersion);
    expect(result.advanced.pluginVersion).toBe(testManifest.pluginVersion);
  });

  it("refuses to advance a record that is no longer the lineage head", async () => {
    const testManifest = await registerTestPlugin();
    const lineage = makeLineage();
    const staleRecord = recordFor(testManifest);
    lineage.seed({ ...staleRecord, stage: "BACKTEST" }); // someone else advanced

    await expect(
      advancePromotionGate({
        manifest: testManifest,
        persistRecord: async () => {},
        readLatestRecord: lineage.head,
        record: staleRecord,
        toStage: "BACKTEST",
      }),
    ).rejects.toThrow("stale promotion record");
  });

  it("refuses a plugin with no promotion lineage at all", async () => {
    const testManifest = await registerTestPlugin();
    await expect(
      advancePromotionGate({
        manifest: testManifest,
        persistRecord: async () => {},
        readLatestRecord: () => Promise.resolve(null),
        record: recordFor(testManifest),
        toStage: "BACKTEST",
      }),
    ).rejects.toThrow("no promotion lineage");
  });

  it("refuses two concurrent advances of the same plugin past the head", async () => {
    const testManifest = await registerTestPlugin();
    const lineage = makeLineage();
    const record = recordFor(testManifest);
    lineage.seed(record);

    // Both operators read the same DRAFT head; the first advance moves the
    // head before the second's gate check runs.
    const first = advancePromotionGate({
      manifest: testManifest,
      persistRecord: async (r) => {
        lineage.seed(r);
      },
      readLatestRecord: lineage.head,
      record,
      toStage: "BACKTEST",
    });
    const second = advancePromotionGate({
      manifest: testManifest,
      persistRecord: async () => {},
      readLatestRecord: lineage.head,
      record,
      toStage: "BACKTEST",
    });
    await expect(first).resolves.toBeTruthy();
    await expect(second).rejects.toThrow("stale promotion record");
  });

  it("refuses to advance a plugin that is not registered", async () => {
    await expect(
      advancePromotionGate({
        manifest: {
          ...manifest,
          configHash: "b".repeat(64),
          pluginId: "ghost-v1",
        },
        persistRecord: async () => {},
        readLatestRecord: () => Promise.resolve(null),
        record: {
          ...recordFor(manifest),
          pluginId: "ghost-v1",
        },
        toStage: "BACKTEST",
      }),
    ).rejects.toThrow("is not registered");
  });

  it("refuses when the record's version does not match the registered manifest version", async () => {
    const testManifest = await registerTestPlugin();
    await expect(
      advancePromotionGate({
        manifest: testManifest,
        persistRecord: async () => {},
        readLatestRecord: () => Promise.resolve(null),
        record: {
          ...recordFor(testManifest),
          pluginVersion: "other-version",
        },
        toStage: "BACKTEST",
      }),
    ).rejects.toThrow("does not match the requested");
  });

  it("refuses an illegal stage transition even with clean fixtures", async () => {
    const testManifest = await registerTestPlugin();
    const lineage = makeLineage();
    // DRAFT -> LIVE skips every stage; fixtures pass but policy refuses.
    const record = recordFor(testManifest);
    lineage.seed(record);
    await expect(
      advancePromotionGate({
        manifest: testManifest,
        persistRecord: async () => {},
        readLatestRecord: lineage.head,
        record,
        toStage: "LIVE",
      }),
    ).rejects.toThrow("Invalid promotion transition");
  });

  it("refuses a record with incomplete evaluation metadata", async () => {
    const testManifest = await registerTestPlugin();
    const lineage = makeLineage();
    const record: PromotionRecord = {
      configHash: testManifest.configHash,
      dataSnapshotIds: [],
      evaluatedAt: new Date().toISOString(),
      pluginId: testManifest.pluginId,
      pluginVersion: testManifest.pluginVersion,
      policyHash: "p".repeat(64),
      stage: "DRAFT",
    };
    lineage.seed(record);
    await expect(
      advancePromotionGate({
        manifest: testManifest,
        persistRecord: async () => {},
        readLatestRecord: lineage.head,
        record,
        toStage: "BACKTEST",
      }),
    ).rejects.toThrow("missing immutable evaluation metadata");
  });

  it("keeps advancePromotion semantics intact for the gate path", () => {
    // Direct-policy regression guard: the gate delegates, not re-implements.
    const record = recordFor(manifest);
    expect(advancePromotion(record, "BACKTEST").stage).toBe("BACKTEST");
    expect(() => advancePromotion(record, "LIVE")).toThrow(
      "Invalid promotion transition",
    );
  });
});
