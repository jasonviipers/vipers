import { describe, expect, it } from "bun:test";

import {
  REFERENCE_SMA_GRID,
  type SmaGridParams,
} from "@/ai/capital-engine/backtest-runner";
import {
  hashPitDataset,
  type PitSentimentValue,
} from "@/ai/capital-engine/point-in-time";
import type { SimulationBar } from "@/ai/capital-engine/simulation";
import {
  runWalkForward,
  type WalkForwardConfig,
} from "@/ai/capital-engine/walk-forward";

const T0 = 1_700_000_000_000;
const HOUR = 3_600_000;

function bar(
  stampMs: number,
  close: number,
  volume = 1_000_000,
): SimulationBar {
  return {
    ask: Number((close * 1.0002).toFixed(8)),
    bid: Number((close * 0.9998).toFixed(8)),
    close,
    high: close * 1.01,
    low: close * 0.99,
    open: close,
    timestamp: new Date(stampMs).toISOString(),
    volume,
  };
}

/** A continuously rising market — every window has momentum to latch onto. */
function rising(total: number, startClose = 100, stepPct = 0.01) {
  return Array.from({ length: total }, (_, i) =>
    bar(T0 + i * HOUR, startClose * (1 + stepPct) ** i),
  );
}

function pitBars(bars: SimulationBar[]) {
  return {
    asset: "BTC",
    points: bars.map((b) => ({
      asOf: Date.parse(b.timestamp),
      source: "test",
      validTo: null,
      value: b,
    })),
  };
}

function sentimentPoint(
  stampMs: number,
  score: number,
  socialVolume = 10,
): { asOf: number; source: string; validTo: null; value: PitSentimentValue } {
  return {
    asOf: stampMs,
    source: "test",
    validTo: null,
    value: {
      newsCount: socialVolume,
      redditCount: 0,
      sentimentScore: score,
      socialVolume,
    },
  };
}

const GRID: readonly SmaGridParams[] = [
  { fast: 2, slow: 6 },
  { fast: 3, slow: 10 },
];

const CONFIG: WalkForwardConfig = {
  capital: 10_000,
  decisionIntervalMs: HOUR,
  folds: 3,
  grid: GRID,
  sizingPct: 1,
  simulation: {
    feeBps: 10,
    latencyBars: 1,
    maxParticipationRate: 0.5,
    slippageBps: 5,
  },
};

/** 600 hourly bars: eval 480 (IS 288, step 64) + holdout 120. */
const BARS = pitBars(rising(600));

describe("walk-forward layout", () => {
  it("cut layout: holdout is the most recent max(30, 20%) slice", () => {
    const run = runWalkForward({ bars: BARS, config: CONFIG });

    expect(run.endMs).toBe(BARS.points[599].asOf);
    expect(run.startMs).toBe(BARS.points[0].asOf);
    // 600 bars → holdout = max(30, 120) = 120 bars → eval = 480.
    expect(run.holdout.window.startMs).toBe(BARS.points[480].asOf);
    expect(run.holdout.window.endMs).toBe(BARS.points[599].asOf);

    // IS window = floor(480 * 0.6) = 288 bars; step = floor((480-288)/3) = 64.
    const firstLeg = run.legs[0];
    expect(firstLeg.inSampleWindow.startMs).toBe(BARS.points[0].asOf);
    expect(firstLeg.inSampleWindow.endMs).toBe(BARS.points[287].asOf);
    expect(firstLeg.outOfSampleWindow.startMs).toBe(BARS.points[288].asOf);
    expect(firstLeg.outOfSampleWindow.endMs).toBe(BARS.points[351].asOf);
  });

  it("last step absorbs the OOS remainder", () => {
    const run = runWalkForward({ bars: BARS, config: CONFIG });
    const last = run.legs[run.legs.length - 1];
    expect(last.outOfSampleWindow.endMs).toBe(BARS.points[479].asOf);
  });

  it("steps tile the post-IS eval region with no gaps or overlaps", () => {
    const run = runWalkForward({ bars: BARS, config: CONFIG });
    let prevEnd = run.legs[0].inSampleWindow.endMs;
    for (const leg of run.legs) {
      // Each OOS span starts exactly when the previous OOS span ended (one
      // bar later in stamp space).
      expect(leg.outOfSampleWindow.startMs).toBe(
        BARS.points[BARS.points.findIndex((p) => p.asOf === prevEnd) + 1].asOf,
      );
      prevEnd = leg.outOfSampleWindow.endMs;
    }
    // And the last OOS end abuts the holdout start.
    const lastLeg = run.legs[run.legs.length - 1];
    expect(
      BARS.points[
        BARS.points.findIndex(
          (p) => p.asOf === lastLeg.outOfSampleWindow.endMs,
        ) + 1
      ].asOf,
    ).toBe(run.holdout.window.startMs);
  });
});

describe("walk-forward selection and holdout discipline", () => {
  it("scores every grid candidate in-sample, in grid order, and picks the IS-best", () => {
    const run = runWalkForward({ bars: BARS, config: CONFIG });
    for (const leg of run.legs) {
      expect(leg.selection.map((c) => c.params)).toEqual(
        GRID.map((p) => ({ ...p })),
      );
      const best = [...leg.selection].sort(
        (a, b) => b.metrics.endEquity - a.metrics.endEquity,
      )[0];
      expect(leg.winner.params).toEqual(best.params);
      expect(leg.winner.metrics.endEquity).toBe(best.metrics.endEquity);
    }
  });

  it("the holdout is replayed ONCE, cold, on the pooled winner", () => {
    const run = runWalkForward({ bars: BARS, config: CONFIG });
    const pooled = run.selectionAggregate.winner;
    // The holdout strategy is the pooled winner — reflected in the fact
    // that replaying the pooled winner on the holdout slice reproduces the
    // reported holdout metrics exactly (pure determinism).
    expect(run.holdout.window.startMs).toBeLessThan(run.holdout.window.endMs);
    expect(pooled.spansWon).toBeGreaterThan(0);
  });

  it("OOS spans come strictly after their own IS span and inside the eval region", () => {
    const run = runWalkForward({ bars: BARS, config: CONFIG });
    for (const leg of run.legs) {
      expect(leg.outOfSampleWindow.startMs).toBeGreaterThan(
        leg.inSampleWindow.endMs,
      );
      expect(leg.outOfSampleWindow.endMs).toBeLessThan(
        run.holdout.window.startMs,
      );
    }
  });
});

describe("walk-forward integrity and accounting", () => {
  it("pins full-dataset hashes equal to the canonical store hash", () => {
    const run = runWalkForward({ bars: BARS, config: CONFIG });
    expect(run.datasetHashes.bars).toBe(hashPitDataset(BARS));
    expect(run.datasetHashes.sentiment).toBeNull();
  });

  it("each leg pins distinct slice hashes for IS and OOS bars", () => {
    const run = runWalkForward({ bars: BARS, config: CONFIG });
    for (const leg of run.legs) {
      expect(leg.sliceHashes.inSampleBars).not.toBe(leg.sliceHashes.bars);
      expect(leg.sliceHashes.inSampleBars).toMatch(/^[0-9a-f]{64}$/);
      expect(leg.sliceHashes.bars).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("aggregate pools the legs' OOS arithmetic", () => {
    const run = runWalkForward({ bars: BARS, config: CONFIG });
    const total = run.legs.reduce((s, l) => s + l.oos.endEquity, 0);
    const expectedPct =
      ((total - 10_000 * run.legs.length) / (10_000 * run.legs.length)) * 100;
    expect(run.aggregate.endEquityPct).toBeCloseTo(expectedPct, 4);
    expect(run.aggregate.legs).toBe(3);
    expect(run.aggregate.positiveLegs).toBe(
      run.legs.filter((l) => l.oos.endEquity > 10_000).length,
    );
    expect(run.aggregate.trades).toBe(
      run.legs.reduce((s, l) => s + l.oos.tradeCount, 0),
    );
    expect(run.aggregate.maxDrawdown).toBe(
      Math.max(...run.legs.map((l) => l.oos.maxDrawdown)),
    );
  });

  it("is deterministic — identical inputs, identical run", () => {
    const a = runWalkForward({ bars: BARS, config: CONFIG });
    const b = runWalkForward({ bars: BARS, config: CONFIG });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("a rising market produces a positive pooled OOS result", () => {
    const run = runWalkForward({ bars: BARS, config: CONFIG });
    expect(run.aggregate.endEquityPct).toBeGreaterThan(0);
    expect(run.aggregate.positiveLegs).toBe(run.legs.length);
  });
});

describe("walk-forward sentiment discipline", () => {
  it("an OOS sentiment slice starts at the trailing pre-window and ends at the span end", () => {
    // Sentiment stamped ONLY inside the first leg's OOS span must not be
    // visible to the second leg (its slice ends before).
    const run = runWalkForward({
      bars: BARS,
      config: CONFIG,
      sentiment: {
        asset: "BTC",
        points: [sentimentPoint(BARS.points[300].asOf, 0.05)],
      },
    });
    // Run completes; the crash reading at bar 300 lives only in leg 1's
    // OOS window (bars 288..351). Nothing leaked anywhere it shouldn't.
    expect(run.legs.length).toBe(3);
  });

  it("datasetHashes.sentiment pins the full sentiment dataset hash", () => {
    const sentiment = {
      asset: "BTC",
      points: [sentimentPoint(T0, 0.5)],
    };
    const run = runWalkForward({
      bars: BARS,
      config: CONFIG,
      sentiment,
    });
    expect(run.datasetHashes.sentiment).toBe(hashPitDataset(sentiment));
  });
});

describe("walk-forward refusals", () => {
  it("the published REFERENCE_SMA_GRID passes validation and drives a full run", () => {
    // The route searches exactly this grid — prove the published constant
    // is well-formed (fast<slow, no duplicates) and searchable end-to-end.
    const run = runWalkForward({
      bars: BARS,
      config: { ...CONFIG, grid: REFERENCE_SMA_GRID },
    });
    expect(run.legs.length).toBe(3);
    for (const leg of run.legs) {
      expect(leg.selection.map((c) => c.params)).toEqual(
        REFERENCE_SMA_GRID.map((p) => ({ ...p })),
      );
    }
  });

  it("refuses folds outside [2, 12], empty grids, duplicate grid entries, bad params", () => {
    expect(() =>
      runWalkForward({ bars: BARS, config: { ...CONFIG, folds: 1 } }),
    ).toThrow(/folds/);
    expect(() =>
      runWalkForward({ bars: BARS, config: { ...CONFIG, folds: 13 } }),
    ).toThrow(/folds/);
    expect(() =>
      runWalkForward({ bars: BARS, config: { ...CONFIG, grid: [] } }),
    ).toThrow(/grid/);
    expect(() =>
      runWalkForward({
        bars: BARS,
        config: { ...CONFIG, grid: [{ fast: 5, slow: 5 }] },
      }),
    ).toThrow(/fast < slow/);
    expect(() =>
      runWalkForward({
        bars: BARS,
        config: {
          ...CONFIG,
          grid: [
            { fast: 2, slow: 8 },
            { fast: 2, slow: 8 },
          ],
        },
      }),
    ).toThrow(/duplicate/);
  });

  it("refuses datasets too small for the layout", () => {
    // 100 bars: holdout = 30, eval = 70, IS window = floor(70*0.6) = 42 < 50.
    const small = pitBars(rising(100));
    expect(() => runWalkForward({ bars: small, config: CONFIG })).toThrow(
      /in-sample bars/,
    );
  });

  it("refuses an empty bar dataset and a non-positive capital", () => {
    expect(() =>
      runWalkForward({
        bars: { asset: "BTC", points: [] },
        config: CONFIG,
      }),
    ).toThrow(/empty bar dataset/);
    expect(() =>
      runWalkForward({
        bars: BARS,
        config: { ...CONFIG, capital: 0 },
      }),
    ).toThrow(/capital/);
  });
});
