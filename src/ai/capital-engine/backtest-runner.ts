import {
  type PitDataset,
  PitLeakageError,
  type PitSentimentValue,
  pitBarAt,
  pitValueAt,
} from "@/ai/capital-engine/point-in-time";
import {
  type SimulationBar,
  type SimulationConfig,
  type SimulationFill,
  type SimulationOrder,
  simulateOrder,
} from "@/ai/capital-engine/simulation";

/**
 * Backtest runner (checklist §7 — "drive a backtest over an ingested PIT
 * dataset"). Pure and deterministic: it walks a decision grid over an
 * INGESTED dataset, and every market/sentiment read goes through the PIT
 * as-of reader — the runner is structurally incapable of seeing data that
 * did not exist at the decision moment (a too-early query throws
 * PitLeakageError and the decision is skipped and counted, never silently
 * replaced with newer data).
 *
 * Strategy seam: `decide` receives ONLY pit-read inputs (bar + sentiment as
 * of the decision moment) and returns a direction or NO_TRADE. A stateful
 * strategy builds its indicator history from those as-of bars alone — it can
 * never see a future close because the runner never hands it one.
 *
 * Fills come from the existing simulator (`simulateOrder`), whose own
 * `submittedAt` lookup follows the same never-newer-than rule and models
 * fees, spread, slippage, latency, participation-capped partial fills, and
 * rejects.
 *
 * The runner does not read the clock, DB, or network — the same clock/DB-free
 * discipline as the rest of capital-engine's pure cores. Dataset identity
 * hashes ride along so a promotion record can pin the exact bytes consumed.
 */

export type BacktestDirection = "LONG" | "SHORT";

export interface BacktestDecisionInput {
  bar: SimulationBar;
  /** Null before the sentiment archive's first stamp (nothing observed yet). */
  sentiment: PitSentimentValue | null;
}

export type BacktestDecision =
  | { direction: BacktestDirection; type: "TRADE" }
  | { reason: string; type: "NO_TRADE" };

export type BacktestStrategy = (
  input: BacktestDecisionInput,
) => BacktestDecision;

export interface BacktestConfig {
  /** Base currency committed at t0; the runner holds one round-trip at a time. */
  capital: number;
  /** Decision grid spacing (>= 60_000 ms). */
  decisionIntervalMs: number;
  /** Fraction of current equity committed per entry (0 < sizing <= 1). */
  sizingPct: number;
  strategy: BacktestStrategy;
  /** Simulator costs — fees/spread/slippage/latency/participation. */
  simulation: SimulationConfig;
}

export interface BacktestTrade {
  direction: BacktestDirection;
  entryFill: SimulationFill;
  entryTimestamp: string;
  exitFill: SimulationFill | null;
  exitReason: string | null;
  /** Realized PnL in base currency net of both fees (null when exit never filled). */
  pnl: number | null;
}

export interface BacktestMetrics {
  decisionCount: number;
  endEquity: number;
  /** Max peak-to-trough equity drawdown (mark-to-market while holding), base currency. */
  maxDrawdown: number;
  noTradeCount: number;
  /** Mean of the worst 5% of trades (base currency); null with < 5 closed trades. */
  tailLoss5: number | null;
  totalFees: number;
  tradeCount: number;
  winRate: number | null;
}

export interface BacktestDatasetIdentity {
  bars: string;
  sentiment: string | null;
}

export interface BacktestRun {
  decisionsSkippedForLeakage: number;
  /** Pin both hashes into the promotion record for reproducibility. */
  datasetHashes: BacktestDatasetIdentity;
  metrics: BacktestMetrics;
  startMs: number;
  endMs: number;
  trades: BacktestTrade[];
}

const MIN_INTERVAL_MS = 60_000;

/**
 * One candidate in the predeclared reference grid: SMA(fast/slow) momentum
 * with the reference sentiment gate.
 */
export interface SmaGridParams {
  fast: number;
  slow: number;
}

/**
 * PREDECLARED candidate grid for the reference strategy. The walk-forward
 * evaluation searches ONLY within this list: the grid is fixed at
 * publication, and widening it after seeing results would be data snooping
 * on the same window the winner is scored on. A different grid is a NEW
 * evaluation with a NEW holdout, never a re-interpretation of this one.
 */
export const REFERENCE_SMA_GRID: readonly SmaGridParams[] = [
  { fast: 2, slow: 8 },
  { fast: 3, slow: 12 },
  { fast: 4, slow: 16 },
  { fast: 6, slow: 24 },
  { fast: 8, slow: 32 },
];

function assertConfig(config: BacktestConfig): void {
  if (!(config.capital > 0) || !Number.isFinite(config.capital)) {
    throw new Error("backtest capital must be a positive finite number");
  }
  if (
    !Number.isInteger(config.decisionIntervalMs) ||
    config.decisionIntervalMs < MIN_INTERVAL_MS
  ) {
    throw new Error(
      `backtest decisionIntervalMs must be an integer >= ${MIN_INTERVAL_MS}`,
    );
  }
  if (!(config.sizingPct > 0 && config.sizingPct <= 1)) {
    throw new Error("backtest sizingPct must be in (0, 1]");
  }
}

/**
 * The reference strategy shipped for the first run: SMA(fast/slow) momentum
 * on close, gated by sentiment — when the archive has an opinion (enough
 * volume, enough edge) the trade must agree with it. Deliberately simple:
 * this first run validates the infrastructure, it is not an alpha claim.
 */
export function createSmaMomentumStrategy(opts?: {
  fast?: number;
  minSocialVolume?: number;
  sentimentEdge?: number;
  slow?: number;
}): BacktestStrategy {
  const fast = opts?.fast ?? 3;
  const slow = opts?.slow ?? 12;
  const sentimentEdge = opts?.sentimentEdge ?? 0.02;
  const minSocialVolume = opts?.minSocialVolume ?? 0;
  if (!(fast > 0 && slow > fast)) {
    throw new Error("SMA windows must satisfy 0 < fast < slow");
  }
  const history: number[] = [];

  const sma = (n: number): number | null => {
    if (history.length < n) {
      return null;
    }
    const slice = history.slice(-n);
    return slice.reduce((a, b) => a + b, 0) / n;
  };

  return ({ bar, sentiment }) => {
    if (Number.isFinite(bar.close) && bar.close > 0) {
      history.push(bar.close);
    }
    const fastSma = sma(fast);
    const slowSma = sma(slow);
    if (fastSma === null || slowSma === null) {
      return {
        reason: `warming up (${history.length}/${slow} bars)`,
        type: "NO_TRADE",
      };
    }
    // Sentiment gate: an archive reading with enough volume and enough edge
    // must agree with the momentum direction; a thin/absent reading passes.
    const sentimentFilter = sentiment
      ? sentiment.socialVolume >= minSocialVolume &&
        Math.abs(sentiment.sentimentScore - 0.5) >= sentimentEdge
        ? sentiment.sentimentScore > 0.5
          ? ("LONG" as const)
          : ("SHORT" as const)
        : null
      : null;

    if (fastSma > slowSma) {
      if (sentimentFilter && sentimentFilter !== "LONG") {
        return {
          reason: "sentiment disagrees with long momentum",
          type: "NO_TRADE",
        };
      }
      return { direction: "LONG", type: "TRADE" };
    }
    if (fastSma < slowSma) {
      if (sentimentFilter && sentimentFilter !== "SHORT") {
        return {
          reason: "sentiment disagrees with short momentum",
          type: "NO_TRADE",
        };
      }
      return { direction: "SHORT", type: "TRADE" };
    }
    return { reason: "SMAs flat", type: "NO_TRADE" };
  };
}

/**
 * Run the backtest. Decision grid: every `decisionIntervalMs` from the first
 * bar stamp through the last. Each decision:
 *   1. PIT bar read as of t (leakage-refusing).
 *   2. PIT sentiment read as of t (honest null before the archive starts).
 *   3. Strategy decides; NO_TRADE counts and moves on.
 *   4. Flat + TRADE → entry order (equity × sizingPct, market) fills via
 *      simulateOrder with submittedAt = the decision stamp.
 *   5. Holding → exit at the first decision stamp where the strategy flips
 *      (opposite-side market order), or at end-of-data.
 * Equity accounting: realized equity = capital − all fees + Σ realized PnL;
 * drawdown tracks mark-to-market equity while holding.
 */
export function runBacktest(input: {
  bars: PitDataset<SimulationBar>;
  config: BacktestConfig;
  identity: BacktestDatasetIdentity;
  sentiment?: PitDataset<PitSentimentValue> | null;
}): BacktestRun {
  assertConfig(input.config);
  if (input.bars.points.length === 0) {
    throw new Error("backtest refuses an empty bar dataset");
  }

  const firstStamp = input.bars.points[0].asOf;
  const lastStamp = input.bars.points[input.bars.points.length - 1].asOf;
  const { decisionIntervalMs, sizingPct, simulation, capital } = input.config;
  const allBars = input.bars.points.map((p) => p.value);

  // The last stamp where an order can still FILL: the simulator's latency
  // model needs `latencyBars` bars after the order's bar, so a liquidation
  // submitted at the dataset's final stamp would never fill. The end-of-data
  // liquidation therefore happens at the last actionable stamp — an order
  // there still fills INSIDE the window (uniform bar spacing assumed; the
  // ingested feeds are uniform).
  const barSpacingMs =
    input.bars.points.length > 1
      ? input.bars.points[1].asOf - input.bars.points[0].asOf
      : decisionIntervalMs;
  const lastActionableMs = Math.max(
    firstStamp,
    lastStamp - simulation.latencyBars * barSpacingMs,
  );

  let equity = capital;
  let fees = 0;
  let decisions = 0;
  let noTrades = 0;
  let skippedForLeakage = 0;
  let peak = capital;
  let maxDrawdown = 0;
  const trades: BacktestTrade[] = [];

  let open: {
    direction: BacktestDirection;
    entry: SimulationFill;
    entryTimestamp: string;
    quantity: number;
  } | null = null;

  for (let t = firstStamp; t <= lastStamp; t += decisionIntervalMs) {
    decisions += 1;

    let bar: SimulationBar;
    try {
      bar = pitBarAt(input.bars, t);
    } catch (error) {
      if (error instanceof PitLeakageError) {
        // The grid starts AT the first stamp, so this is defensive; count
        // and skip — never fabricate a reading.
        skippedForLeakage += 1;
        continue;
      }
      throw error;
    }
    const stampIso = new Date(t).toISOString();

    let sentiment: PitSentimentValue | null = null;
    if (input.sentiment) {
      try {
        sentiment = pitValueAt(input.sentiment, t).value;
      } catch {
        // Before the archive's first stamp the system had observed nothing —
        // an honest null, never newer data.
        sentiment = null;
      }
    }

    const decision = input.config.strategy({ bar, sentiment });

    if (open) {
      const atEnd = t + decisionIntervalMs > lastActionableMs;
      const shouldExit =
        (decision.type === "TRADE" && decision.direction !== open.direction) ||
        atEnd;
      if (!shouldExit) {
        // Holding: mark-to-market the drawdown tracker.
        const mtm =
          open.direction === "LONG"
            ? (bar.close - open.entry.fillPrice) * open.quantity
            : (open.entry.fillPrice - bar.close) * open.quantity;
        const mtmEquity = equity + mtm;
        peak = Math.max(peak, mtmEquity);
        maxDrawdown = Math.max(maxDrawdown, peak - mtmEquity);
        continue;
      }
      const exitOrder: SimulationOrder = {
        direction: open.direction === "LONG" ? "SHORT" : "LONG",
        quantity: open.quantity,
        submittedAt: stampIso,
      };
      const exitFill = simulateOrder(allBars, exitOrder, simulation);
      if (exitFill.status === "REJECTED" || exitFill.filledQuantity <= 0) {
        // End-of-data with no fillable bar: the position never closed —
        // record it honestly as unrealized, not as a round-trip.
        trades.push({
          direction: open.direction,
          entryFill: open.entry,
          entryTimestamp: open.entryTimestamp,
          exitFill: null,
          exitReason: "exit-unfilled-at-end-of-data",
          pnl: null,
        });
        open = null;
        break;
      }
      const grossSpread =
        open.direction === "LONG"
          ? exitFill.fillPrice - open.entry.fillPrice
          : open.entry.fillPrice - exitFill.fillPrice;
      const pnl =
        grossSpread * exitFill.filledQuantity - open.entry.fee - exitFill.fee;
      fees += exitFill.fee;
      // Cash view: the notional was never debited at entry (this runner
      // realizes round-trips), so the exit credits PROCEEDS (gross − exit
      // fee), not pnl — crediting pnl would subtract the entry basis and
      // entry fee a second time. Identity: endEquity = capital + Σ pnl.
      equity += grossSpread * exitFill.filledQuantity - exitFill.fee;
      trades.push({
        direction: open.direction,
        entryFill: open.entry,
        entryTimestamp: open.entryTimestamp,
        exitFill,
        exitReason: atEnd ? "end-of-data" : "signal-flip",
        pnl: Number(pnl.toFixed(8)),
      });
      open = null;
      peak = Math.max(peak, equity);
      maxDrawdown = Math.max(maxDrawdown, peak - equity);
      if (atEnd) {
        break;
      }
      continue;
    }

    if (decision.type === "NO_TRADE") {
      noTrades += 1;
      continue;
    }

    const notional = equity * sizingPct;
    if (!(notional > 0) || !(bar.close > 0)) {
      noTrades += 1;
      continue;
    }
    const quantity = Number((notional / bar.close).toFixed(8));
    const entryOrder: SimulationOrder = {
      direction: decision.direction,
      quantity,
      submittedAt: stampIso,
    };
    const entryFill = simulateOrder(allBars, entryOrder, simulation);
    if (entryFill.status === "REJECTED" || entryFill.filledQuantity <= 0) {
      noTrades += 1;
      continue;
    }
    fees += entryFill.fee;
    equity -= entryFill.fee;
    open = {
      direction: decision.direction,
      entry: entryFill,
      entryTimestamp: stampIso,
      quantity: entryFill.filledQuantity,
    };
  }

  const closed = trades.filter(
    (tr): tr is BacktestTrade & { pnl: number } => tr.pnl !== null,
  );
  const wins = closed.filter((tr) => tr.pnl > 0);
  const tailCount = Math.max(1, Math.ceil(closed.length * 0.05));
  const tailLoss5 =
    closed.length >= 5
      ? Number(
          (
            [...closed]
              .map((tr) => tr.pnl)
              .sort((a, b) => a - b)
              .slice(0, tailCount)
              .reduce((a, b) => a + b, 0) / tailCount
          ).toFixed(8),
        )
      : null;

  return {
    decisionsSkippedForLeakage: skippedForLeakage,
    datasetHashes: input.identity,
    metrics: {
      decisionCount: decisions,
      endEquity: Number(equity.toFixed(8)),
      maxDrawdown: Number(maxDrawdown.toFixed(8)),
      noTradeCount: noTrades,
      tailLoss5,
      totalFees: Number(fees.toFixed(8)),
      tradeCount: trades.length,
      winRate: closed.length > 0 ? wins.length / closed.length : null,
    },
    startMs: firstStamp,
    endMs: lastStamp,
    trades,
  };
}
