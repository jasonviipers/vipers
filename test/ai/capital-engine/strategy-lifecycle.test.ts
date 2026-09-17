import { beforeEach, describe, expect, it } from "bun:test";

/**
 * Strategy lifecycle: disable must be fail-safe (flag first, audit second,
 * idempotent) and reactivation must be refused while the plugin's fixtures
 * no longer reproduce their recorded behavior.
 *
 * The registry verifier is injected (never mock.module'd): mocking the
 * registry module would leak into the real registry tests under bun's
 * process-global mock registry. DB/lineage are still module-mocked — those
 * are genuine external boundaries, and no other suite exercises them here.
 */

const plugins = new Map<string, { configHash: string; enabled: boolean }>();
const insertedRecords: Array<Record<string, unknown>> = [];
let currentId = "consensus-v1";

mock.module("@/db", () => ({
  db: {
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        insertedRecords.push(values);
        return { returning: async () => [{ id: "record-id" }] };
      },
    }),
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => {
            const row = plugins.get(currentId);
            return row ? [{ ...row, pluginId: currentId }] : [];
          },
        }),
      }),
    }),
    update: () => ({
      set: (values: { enabled?: boolean }) => ({
        where: async () => {
          const row = plugins.get(currentId);
          if (row && values.enabled !== undefined) {
            row.enabled = values.enabled;
          }
        },
      }),
    }),
  },
}));

let headRecord: {
  configHash: string;
  dataSnapshotIds: string[];
  evaluatedAt: string;
  metrics: null;
  pluginId: string;
  pluginVersion: string;
  policyHash: string;
  stage: string;
} | null = null;

mock.module("@/lib/promotion-records", () => ({
  appendPromotionRecord: async (record: Record<string, unknown>) => {
    insertedRecords.push(record);
    headRecord = record as typeof headRecord;
    return "appended-id";
  },
  getLatestPromotionRecord: async (pluginId: string) =>
    headRecord && headRecord.pluginId === pluginId ? headRecord : null,
  registerStrategyPlugin: async () => {},
}));

const { disableStrategyPlugin, reactivateStrategyPlugin } = await import(
  "@/ai/capital-engine/strategy-lifecycle"
);

import type { FixturesVerifier } from "@/ai/capital-engine/strategy-lifecycle";

/** Controllable fake verifier — the injected seam for fixture behavior. */
function makeVerifier(
  behavior: "clean" | "drifted" | "unregistered",
): FixturesVerifier {
  return async () => {
    if (behavior === "unregistered") {
      throw new Error(
        "plugin consensus-v1@hash is not registered; nothing to verify",
      );
    }
    if (behavior === "drifted") {
      throw new Error(
        'plugin consensus-v1 fixture "passthrough" is not deterministic (repetition 2 diverged)',
      );
    }
    return {
      capabilities: [],
      configHash: "0".repeat(64),
      evidenceRequirements: [],
      pluginId: "consensus-v1",
      pluginVersion: "consensus-v1",
    };
  };
}

function seedPlugin(enabled: boolean) {
  plugins.set("consensus-v1", { configHash: "0".repeat(64), enabled });
}

beforeEach(() => {
  currentId = "consensus-v1";
  headRecord = null;
  insertedRecords.length = 0;
  seedPlugin(true);
});

describe("strategy lifecycle", () => {
  it("disables a live plugin, flag first, then the HALTED audit record", async () => {
    headRecord = {
      configHash: "0".repeat(64),
      dataSnapshotIds: ["snapshot-1"],
      evaluatedAt: new Date().toISOString(),
      metrics: null,
      pluginId: "consensus-v1",
      pluginVersion: "consensus-v1",
      policyHash: "p".repeat(64),
      stage: "PAPER",
    };

    const outcome = await disableStrategyPlugin({
      operator: "operator",
      pluginId: "consensus-v1",
      reason: "operator",
      reasonDetail: "pre-deploy review",
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.stage).toBe("PAPER"); // prior head reported
    expect(plugins.get("consensus-v1")?.enabled).toBe(false);
    // An append-only HALTED record was written carrying the reason context.
    const halted = insertedRecords.find((r) => r.stage === "HALTED");
    expect(halted).toBeDefined();
    expect(JSON.stringify(halted?.dataSnapshotIds)).toContain(
      "disable:operator",
    );
    // Prior evaluation evidence is carried forward, not dropped.
    expect(JSON.stringify(halted?.dataSnapshotIds)).toContain("snapshot-1");
  });

  it("refuses an unknown plugin", async () => {
    plugins.clear();
    const outcome = await disableStrategyPlugin({
      operator: "operator",
      pluginId: "consensus-v1",
      reason: "operator",
    });
    expect(outcome).toEqual({ ok: false, reason: "plugin-not-found" });
  });

  it("is idempotent: disabling a disabled plugin is a no-op refusal", async () => {
    seedPlugin(false);
    const outcome = await disableStrategyPlugin({
      operator: "operator",
      pluginId: "consensus-v1",
      reason: "operator",
    });
    expect(outcome).toEqual({ ok: false, reason: "already-disabled" });
    expect(insertedRecords).toHaveLength(0);
  });

  it("reactivates a disabled plugin after clean fixture proof", async () => {
    seedPlugin(false);
    headRecord = {
      configHash: "0".repeat(64),
      dataSnapshotIds: ["snapshot-1"],
      evaluatedAt: new Date().toISOString(),
      metrics: null,
      pluginId: "consensus-v1",
      pluginVersion: "consensus-v1",
      policyHash: "p".repeat(64),
      stage: "HALTED",
    };

    const outcome = await reactivateStrategyPlugin({
      operator: "operator",
      pluginId: "consensus-v1",
      verifyFixtures: makeVerifier("clean"),
    });

    expect(outcome.ok).toBe(true);
    expect(plugins.get("consensus-v1")?.enabled).toBe(true);
    // Reactivation is itself an auditable lineage event at DRAFT.
    const draft = insertedRecords.find((r) => r.stage === "DRAFT");
    expect(draft).toBeDefined();
  });

  it("refuses reactivation while fixtures have drifted", async () => {
    seedPlugin(false);
    const outcome = await reactivateStrategyPlugin({
      operator: "operator",
      pluginId: "consensus-v1",
      verifyFixtures: makeVerifier("drifted"),
    });

    expect(outcome).toEqual({ ok: false, reason: "fixtures-drifted" });
    // Flag untouched: the plugin stays disabled.
    expect(plugins.get("consensus-v1")?.enabled).toBe(false);
  });

  it("refuses reactivation when the registry entry is missing (not loaded)", async () => {
    seedPlugin(false);
    const outcome = await reactivateStrategyPlugin({
      operator: "operator",
      pluginId: "consensus-v1",
      verifyFixtures: makeVerifier("unregistered"),
    });
    expect(outcome).toEqual({ ok: false, reason: "not-loaded" });
    expect(plugins.get("consensus-v1")?.enabled).toBe(false);
  });

  it("refuses reactivation of a plugin that is not disabled", async () => {
    seedPlugin(true);
    const outcome = await reactivateStrategyPlugin({
      operator: "operator",
      pluginId: "consensus-v1",
      verifyFixtures: makeVerifier("clean"),
    });
    expect(outcome).toEqual({ ok: false, reason: "not-disabled" });
  });
});

// Keep the bun mock import used for its module-registration side effect only.
import { mock } from "bun:test";
