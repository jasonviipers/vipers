import { beforeEach, describe, expect, it, mock } from "bun:test";

/**
 * Lineage sequence: the durable double-append guard.
 *
 * appendPromotionRecord allocates seq = head.seq + 1 and the UNIQUE
 * (plugin_id, seq) index in strategy_promotions rejects a concurrent
 * append that computed the same next seq. These tests simulate that DB
 * contract with a stateful mock: two interleaved allocations of the same
 * seq must make the second insert throw the unique-violation the
 * operator surface maps to a stale-lineage refusal.
 *
 * Mocked here (NOT the registry — bun mock.module is process-global):
 * @/db only, with in-memory state mirroring the index's uniqueness.
 */

type Row = {
  createdAt: Date;
  id: string;
  pluginId: string;
  seq: number;
  stage: string;
};

const rows: Row[] = [];

/** Simulates the UNIQUE (plugin_id, seq) index: throws 23505 on conflict. */
function insertRow(row: Row): void {
  const conflict = rows.some(
    (r) => r.pluginId === row.pluginId && r.seq === row.seq,
  );
  if (conflict) {
    const error = new Error(
      'duplicate key value violates unique constraint "strategy_promotions_plugin_seq_uidx"',
    ) as Error & { code?: string };
    error.code = "23505";
    throw error;
  }
  rows.push(row);
}

mock.module("@/db", () => ({
  db: {
    insert: () => ({
      values: (values: { pluginId: string; seq: number; stage: string }) => ({
        returning: async () => {
          // Simulate the await boundary: the insert lands on a later
          // macrotask, so two chains can interleave read→insert — the
          // TOCTOU window the real DB index arbitrates.
          await new Promise((resolve) => setTimeout(resolve, 0));
          insertRow({
            createdAt: new Date(),
            id: `id-${rows.length + 1}`,
            pluginId: values.pluginId,
            seq: values.seq,
            stage: values.stage,
          });
          return [{ id: `id-${rows.length}` }];
        },
      }),
    }),
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: async () => {
              // Same await boundary as the real head read.
              await new Promise((resolve) => setTimeout(resolve, 0));
              const pluginId = currentPluginId();
              const head = rows
                .filter((r) => r.pluginId === pluginId)
                .sort((a, b) => b.seq - a.seq)[0];
              return head ? [head] : [];
            },
          }),
        }),
      }),
    }),
  },
}));

let currentIdValue = "consensus-v1";
function currentPluginId(): string {
  return currentIdValue;
}

import type { PromotionRecord } from "@/ai/capital-engine/promotion";

const { appendPromotionRecord, getLatestPromotionRecord } = await import(
  "@/lib/promotion-records"
);
const { reasonFromGateError } = await import(
  "@/ai/capital-engine/promote-plugin"
);

function recordFor(stage: string): PromotionRecord {
  return {
    configHash: "0".repeat(64),
    dataSnapshotIds: ["snapshot-1"],
    evaluatedAt: new Date().toISOString(),
    metrics: null,
    pluginId: currentPluginId(),
    pluginVersion: "consensus-v1",
    policyHash: "p".repeat(64),
    stage: stage as PromotionRecord["stage"],
  };
}

beforeEach(() => {
  currentIdValue = "consensus-v1";
  rows.length = 0;
});

describe("promotion lineage seq", () => {
  it("allocates 1 for the first append and head.seq + 1 thereafter", async () => {
    await appendPromotionRecord(recordFor("DRAFT"));
    await appendPromotionRecord(recordFor("BACKTEST"));
    await appendPromotionRecord(recordFor("WALK_FORWARD"));

    const head = await getLatestPromotionRecord(currentPluginId());
    expect(head?.stage).toBe("WALK_FORWARD");
    // Three appends → the third record carries seq 3.
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.seq).sort()).toEqual([1, 2, 3]);
  });

  it("keeps per-plugin sequences independent", async () => {
    await appendPromotionRecord(recordFor("DRAFT"));
    currentIdValue = "other-v1";
    await appendPromotionRecord(recordFor("DRAFT"));

    const first = rows.filter((r) => r.pluginId === "consensus-v1");
    const second = rows.filter((r) => r.pluginId === "other-v1");
    expect(first[0].seq).toBe(1);
    expect(second[0].seq).toBe(1);
  });

  it("refuses a concurrent double-append with the unique violation", async () => {
    // Two replicas both read head seq = 1 and both allocate seq 2.
    const replicaA = appendPromotionRecord(recordFor("BACKTEST"));
    const replicaB = appendPromotionRecord(recordFor("BACKTEST"));
    const results = await Promise.allSettled([replicaA, replicaB]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    const error = (rejected[0] as PromiseRejectedResult).reason as Error & {
      code?: string;
    };
    expect(error.code).toBe("23505");
    expect(error.message).toContain("strategy_promotions_plugin_seq_uidx");
  });

  it("maps the unique violation to a stale-head refusal", () => {
    const error = new Error(
      'duplicate key value violates unique constraint "strategy_promotions_plugin_seq_uidx"',
    );
    expect(reasonFromGateError(error)).toBe("stale-head");

    const coded = Object.assign(
      new Error("duplicate key value violates unique constraint"),
      { code: "23505" },
    );
    expect(reasonFromGateError(coded)).toBe("stale-head");
  });

  it("reader returns the highest-seq record even when timestamps tie", async () => {
    const sameInstant = new Date("2026-09-17T00:00:00.000Z");
    rows.push(
      {
        createdAt: sameInstant,
        id: "a",
        pluginId: currentPluginId(),
        seq: 1,
        stage: "DRAFT",
      },
      {
        createdAt: sameInstant,
        id: "b",
        pluginId: currentPluginId(),
        seq: 2,
        stage: "BACKTEST",
      },
    );
    const head = await getLatestPromotionRecord(currentPluginId());
    expect(head?.stage).toBe("BACKTEST");
  });
});
