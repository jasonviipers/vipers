import { beforeEach, describe, expect, it } from "bun:test";

/**
 * Strategy rollback monitor: the automatic half of the rollback triggers.
 * Dependencies are INJECTED, never mock.module'd — bun's mock.module is
 * process-global across test files and poisons other suites (the same
 * convention strategy-lifecycle.test.ts follows). The monitor's own logic —
 * candidate selection, threshold arming, idempotence across passes, and
 * halting through the audited kill switch with a system operator identity —
 * is what's under test; trigger SEMANTICS live in
 * test/lib/rollback-policy.test.ts.
 */

import type { PromotionRecord } from "@/ai/capital-engine/promotion";
import type { RollbackMonitorDeps } from "@/lib/jobs/strategy-rollback-job";

const { runStrategyRollbackMonitor, previewStrategyRollbacks } = await import(
  "@/lib/jobs/strategy-rollback-job"
);

function makeDeps() {
  const plugins = new Map<string, { enabled: boolean; stage: string }>();
  const metrics = new Map<string, PromotionRecord["metrics"]>();
  const halted: string[] = [];
  let thresholds = {
    maxDrawdownPct: 5 as number | null,
    maxLossPct: 5 as number | null,
  };
  let capital = 10_000;

  const deps: RollbackMonitorDeps = {
    halt: async (input) => {
      halted.push(input.pluginId);
      const row = plugins.get(input.pluginId);
      if (row) {
        row.enabled = false;
        row.stage = "HALTED";
        metrics.set(input.pluginId, null);
      }
      return { ok: true };
    },
    isEnabled: async (pluginId) => plugins.get(pluginId)?.enabled ?? false,
    listEnabledPlugins: async () =>
      [...plugins.entries()]
        .filter(([, row]) => row.enabled)
        .map(([pluginId]) => ({ pluginId })),
    readCapital: async () => capital,
    readHead: async (pluginId) => {
      const row = plugins.get(pluginId);
      if (!row) return null;
      return {
        configHash: "0".repeat(64),
        dataSnapshotIds: ["snapshot-1"],
        evaluatedAt: new Date().toISOString(),
        metrics: metrics.get(pluginId) ?? null,
        pluginId,
        pluginVersion: "consensus-v1",
        policyHash: "p".repeat(64),
        stage: row.stage as PromotionRecord["stage"],
      };
    },
    readThresholds: async () => thresholds,
  };

  const seed = (
    pluginId: string,
    stage: string,
    headMetrics: PromotionRecord["metrics"],
  ) => {
    plugins.set(pluginId, { enabled: true, stage });
    metrics.set(pluginId, headMetrics);
  };

  return {
    capital,
    deps,
    halted,
    seed,
    setCapital: (value: number) => {
      capital = value;
    },
    setThresholds: (next: {
      maxDrawdownPct: number | null;
      maxLossPct: number | null;
    }) => {
      thresholds = next;
    },
  };
}

const LIVE_METRICS = {
  evaluationDays: 7,
  maxDrawdownPct: 2,
  pnl: -600, // 6% of 10k
  winRate: 0.4,
};

describe("strategy rollback monitor", () => {
  let world: ReturnType<typeof makeDeps>;

  beforeEach(() => {
    world = makeDeps();
  });

  it("halts an enabled LIVE plugin that breaches the loss threshold through the kill switch", async () => {
    world.seed("breacher", "LIVE", LIVE_METRICS);

    const summary = await runStrategyRollbackMonitor(world.deps);

    expect(summary.halted).toEqual([
      { pluginId: "breacher", reasons: ["loss-threshold"] },
    ]);
    expect(world.halted).toEqual(["breacher"]);
  });

  it("does not touch plugins below thresholds or in non-capital stages", async () => {
    world.seed("healthy", "LIVE", {
      evaluationDays: 7,
      maxDrawdownPct: 2,
      pnl: 100,
      winRate: 0.6,
    });
    world.seed("paper-only", "PAPER", {
      evaluationDays: 7,
      maxDrawdownPct: 40,
      pnl: -9_000, // disaster metrics, but not capital-bearing
      winRate: 0.1,
    });

    const summary = await runStrategyRollbackMonitor(world.deps);

    expect(summary.halted).toEqual([]);
    expect(world.halted).toEqual([]);
  });

  it("is a no-op pass when no threshold is predeclared", async () => {
    world.setThresholds({ maxDrawdownPct: null, maxLossPct: null });
    world.seed("breacher", "LIVE", LIVE_METRICS);

    const summary = await runStrategyRollbackMonitor(world.deps);

    expect(summary.checked).toBe(0);
    expect(summary.halted).toEqual([]);
  });

  it("is idempotent across passes: a rolled-back plugin is skipped next pass", async () => {
    world.seed("breacher", "LIVE", LIVE_METRICS);

    await runStrategyRollbackMonitor(world.deps);
    expect(world.halted).toEqual(["breacher"]);

    // Second pass: the plugin now reads disabled with a HALTED head.
    const second = await runStrategyRollbackMonitor(world.deps);
    expect(second.halted).toEqual([]);
    expect(world.halted).toEqual(["breacher"]);
  });

  it("skips a plugin disabled concurrently between enumeration and the kill", async () => {
    world.seed("raced", "LIVE", LIVE_METRICS);
    // Simulate the race: enumeration sees it enabled, the re-check at
    // kill time sees it disabled.
    const deps: RollbackMonitorDeps = {
      ...world.deps,
      isEnabled: async () => false,
    };

    const summary = await runStrategyRollbackMonitor(deps);

    expect(summary.halted).toEqual([]);
    expect(world.halted).toEqual([]);
  });

  it("preview executes nothing but reports breaches", async () => {
    world.seed("breacher", "LIVE", LIVE_METRICS);
    world.seed("healthy", "LIVE", {
      evaluationDays: 7,
      maxDrawdownPct: 2,
      pnl: 100,
      winRate: 0.6,
    });

    const previews = await previewStrategyRollbacks(world.deps);

    expect(world.halted).toEqual([]);
    const breacher = previews.find((p) => p.pluginId === "breacher");
    expect(breacher?.result.trigger).toBe(true);
    const healthy = previews.find((p) => p.pluginId === "healthy");
    expect(healthy?.result.trigger).toBe(false);
  });

  it("handles a zero capital denominator without crashing the loss axis", async () => {
    world.setCapital(0);
    world.seed("dd-breach", "LIVE", LIVE_METRICS); // drawdown still 2 < 5

    const summary = await runStrategyRollbackMonitor(world.deps);

    expect(summary.halted).toEqual([]);
    expect(summary.skipped).toBe(1);
  });
});
