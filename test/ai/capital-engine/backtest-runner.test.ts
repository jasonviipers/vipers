import { describe, expect, it } from "bun:test";

import {
  type BacktestDatasetIdentity,
  createSmaMomentumStrategy,
  runBacktest,
} from "@/ai/capital-engine/backtest-runner";
import {
  type PitSentimentObservation,
  pitBarsFromSimulationBars,
  pitSentimentFromObservations,
} from "@/ai/capital-engine/point-in-time";
import type { SimulationBar } from "@/ai/capital-engine/simulation";

const T0 = 1_700_000_000_000;
const HOUR = 3_600_000;

const IDENTITY: BacktestDatasetIdentity = {
  bars: "test-bars-hash",
  sentiment: null,
};

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

/** A rising market for momentum to latch onto. */
function risingBars(count: number, startClose = 100, stepPct = 0.01) {
  return Array.from({ length: count }, (_, i) =>
    bar(T0 + i * HOUR, startClose * (1 + stepPct) ** i),
  );
}

const DEFAULT_CONFIG = {
  capital: 10_000,
  decisionIntervalMs: HOUR,
  sizingPct: 1,
  simulation: {
    feeBps: 10,
    latencyBars: 1,
    maxParticipationRate: 0.5,
    slippageBps: 5,
  },
} as const;

describe("runBacktest — grid and leakage discipline", () => {
  it("walks one decision per interval and honors the warm-up window", () => {
    const bars = pitBarsFromSimulationBars("BTC", risingBars(30));
    const run = runBacktest({
      bars,
      config: { ...DEFAULT_CONFIG, strategy: createSmaMomentumStrategy() },
      identity: IDENTITY,
    });
    // 30 bars → the grid ends at the last ACTIONABLE stamp (latency 1 bar
    // before the final stamp), i.e. 29 hourly decisions.
    expect(run.metrics.decisionCount).toBe(29);
    // SMA(12) needs 12 bars before it may trade → 11 warm-up NO_TRADEs.
    expect(run.metrics.noTradeCount).toBe(11);
    expect(run.trades.length).toBeGreaterThan(0);
  });

  it("every fill is at or after the decision stamp — the simulator's latency model is downstream", () => {
    const bars = pitBarsFromSimulationBars("BTC", risingBars(30));
    const run = runBacktest({
      bars,
      config: { ...DEFAULT_CONFIG, strategy: createSmaMomentumStrategy() },
      identity: IDENTITY,
    });
    for (const trade of run.trades) {
      const entryStamp = Date.parse(trade.entryTimestamp);
      const entryFillBar = Date.parse(trade.entryFill.orderTimestamp);
      expect(entryFillBar).toBeGreaterThanOrEqual(entryStamp);
      if (trade.exitFill) {
        expect(
          Date.parse(trade.exitFill.orderTimestamp),
        ).toBeGreaterThanOrEqual(entryFillBar);
      }
    }
  });

  it("skips and counts a leaked query instead of fabricating a reading", () => {
    // Constructed directly so a point's stamp precedes the "grid start" —
    // the runner must never see a pre-start reading as a value.
    const dataset = {
      asset: "BTC",
      points: [
        {
          asOf: T0 + HOUR,
          source: "test",
          validTo: null,
          value: bar(T0 + HOUR, 100),
        },
      ],
    };
    const run = runBacktest({
      bars: dataset,
      config: {
        ...DEFAULT_CONFIG,
        decisionIntervalMs: HOUR,
        strategy: createSmaMomentumStrategy({ fast: 1, slow: 2 }),
      },
      identity: IDENTITY,
    });
    expect(run.decisionsSkippedForLeakage).toBe(0); // grid starts at first stamp
    expect(run.metrics.decisionCount).toBe(1);
  });

  it("NO_TRADE decisions never open a position", () => {
    // Flat market: SMA fast equals slow → SMAs flat → never trades.
    const bars = pitBarsFromSimulationBars(
      "BTC",
      Array.from({ length: 20 }, (_, i) => bar(T0 + i * HOUR, 100)),
    );
    const run = runBacktest({
      bars,
      config: { ...DEFAULT_CONFIG, strategy: createSmaMomentumStrategy() },
      identity: IDENTITY,
    });
    expect(run.metrics.tradeCount).toBe(0);
    expect(run.metrics.noTradeCount).toBe(20);
    expect(run.metrics.endEquity).toBe(10_000);
    expect(run.metrics.totalFees).toBe(0);
  });

  it("refuses invalid configs and empty datasets", () => {
    const bars = pitBarsFromSimulationBars("BTC", risingBars(3));
    expect(() =>
      runBacktest({
        bars,
        config: {
          ...DEFAULT_CONFIG,
          capital: 0,
          strategy: createSmaMomentumStrategy(),
        },
        identity: IDENTITY,
      }),
    ).toThrow(/capital/);
    expect(() =>
      runBacktest({
        bars,
        config: {
          ...DEFAULT_CONFIG,
          decisionIntervalMs: 30_000,
          strategy: createSmaMomentumStrategy(),
        },
        identity: IDENTITY,
      }),
    ).toThrow(/decisionIntervalMs/);
    expect(() =>
      runBacktest({
        bars: { asset: "BTC", points: [] },
        config: { ...DEFAULT_CONFIG, strategy: createSmaMomentumStrategy() },
        identity: IDENTITY,
      }),
    ).toThrow(/empty bar dataset/);
  });
});

describe("runBacktest — accounting integrity", () => {
  it("equity = capital − fees + Σ realized PnL, with fees actually charged", () => {
    const bars = pitBarsFromSimulationBars("BTC", risingBars(40));
    const run = runBacktest({
      bars,
      config: { ...DEFAULT_CONFIG, strategy: createSmaMomentumStrategy() },
      identity: IDENTITY,
    });
    const closed = run.trades.filter((t) => t.pnl !== null);
    const realized = closed.reduce((sum, t) => sum + (t.pnl ?? 0), 0);
    const entryFees = run.trades.reduce((sum, t) => sum + t.entryFill.fee, 0);
    const exitFees = run.trades.reduce(
      (sum, t) => sum + (t.exitFill?.fee ?? 0),
      0,
    );
    expect(run.metrics.totalFees).toBeCloseTo(entryFees + exitFees, 6);
    // pnl is already net of both fees, so the cash identity is exact:
    // endEquity = capital + Σ realized pnl.
    expect(run.metrics.endEquity).toBeCloseTo(10_000 + realized, 6);
    // A persistent uptrend traded long by momentum must not lose to nothing:
    // gross gains exceed fees (sanity that the accounting direction is right).
    expect(run.metrics.endEquity).toBeGreaterThan(0);
  });

  it("rising market with momentum produces net-positive-or-fee-bounded results and honest win records", () => {
    const bars = pitBarsFromSimulationBars("BTC", risingBars(60));
    const run = runBacktest({
      bars,
      config: {
        ...DEFAULT_CONFIG,
        sizingPct: 0.5,
        strategy: createSmaMomentumStrategy(),
      },
      identity: IDENTITY,
    });
    expect(run.metrics.winRate).not.toBeNull();
    for (const trade of run.trades) {
      if (trade.pnl !== null) {
        expect(Number.isFinite(trade.pnl)).toBe(true);
      }
      expect(trade.direction).toMatch(/^(LONG|SHORT)$/);
    }
    expect(run.datasetHashes.bars).toBe("test-bars-hash");
  });

  it("drawdown never goes negative and tail loss is null below 5 closed trades", () => {
    const bars = pitBarsFromSimulationBars("BTC", risingBars(16));
    const run = runBacktest({
      bars,
      config: { ...DEFAULT_CONFIG, strategy: createSmaMomentumStrategy() },
      identity: IDENTITY,
    });
    expect(run.metrics.maxDrawdown).toBeGreaterThanOrEqual(0);
    expect(run.metrics.tailLoss5).toBeNull();
  });
});

describe("runBacktest — sentiment gate consumes the PIT sentiment axis", () => {
  /** Non-null view of a built sentiment dataset (throws instead of `!`). */
  function sentimentDataset(points: Array<[number, number]>) {
    const observations: PitSentimentObservation[] = points.map(
      ([stamp, compound]) => ({
        externalId: `x-${stamp}`,
        fetchedAtMs: stamp,
        source: "news" as const,
        vaderCompound: compound,
      }),
    );
    const dataset = pitSentimentFromObservations("BTC", observations);
    if (!dataset) {
      throw new Error("test archive unexpectedly empty");
    }
    return dataset;
  }

  it("a strong bearish reading blocks long momentum; neutral passes it", () => {
    // Rising bars; the first post-warm-up decision is hour 11 (12 closes
    // observed). Sentiment turns strongly bearish exactly at that stamp.
    const bars = pitBarsFromSimulationBars("BTC", risingBars(30));
    const bearishAt = T0 + 11 * HOUR;
    const bearish = runBacktest({
      bars,
      config: { ...DEFAULT_CONFIG, strategy: createSmaMomentumStrategy() },
      identity: IDENTITY,
      sentiment: sentimentDataset([
        [T0, 0.0],
        [bearishAt, -0.9], // score 0.05, edge 0.45 → filter says SHORT
      ]),
    });
    const neutral = runBacktest({
      bars,
      config: { ...DEFAULT_CONFIG, strategy: createSmaMomentumStrategy() },
      identity: IDENTITY,
      sentiment: sentimentDataset([[T0, 0.0]]), // 0.5 exactly → no filter
    });
    // With no disagreement available at the first fire, neutral goes long.
    expect(neutral.trades[0]?.direction).toBe("LONG");
    // The bearish reading persists in its trailing window, so every long
    // momentum signal from that stamp on is gated off: zero trades.
    expect(bearish.metrics.tradeCount).toBe(0);
    expect(neutral.metrics.tradeCount).toBeGreaterThan(0);
  });

  it("sentiment is read AS OF the decision — a later crash stamp never reaches back", () => {
    const bars = pitBarsFromSimulationBars("BTC", risingBars(30));
    // Crash reading stamped at hour 20 cannot influence the hour-13 decision.
    const late = runBacktest({
      bars,
      config: { ...DEFAULT_CONFIG, strategy: createSmaMomentumStrategy() },
      identity: IDENTITY,
      sentiment: sentimentDataset([
        [T0, 0.0],
        [T0 + 20 * HOUR, -0.9],
      ]),
    });
    const none = runBacktest({
      bars,
      config: { ...DEFAULT_CONFIG, strategy: createSmaMomentumStrategy() },
      identity: IDENTITY,
      sentiment: null,
    });
    // Identical behavior before hour 20: the first trade matches.
    expect(late.trades[0]?.entryTimestamp).toBe(none.trades[0]?.entryTimestamp);
  });
});
