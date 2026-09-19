import {
  type BacktestDatasetIdentity,
  type BacktestMetrics,
  createSmaMomentumStrategy,
  runBacktest,
  type SmaGridParams,
} from "./backtest-runner";
import {
  hashPitDataset,
  type PitDataset,
  type PitSentimentValue,
} from "./point-in-time";
import type { SimulationBar, SimulationConfig } from "./simulation";

/**
 * Walk-forward / holdout evaluation core (checklist §7 — "Run walk-forward
 * and untouched holdout evaluations").
 *
 * Layout, fixed by predeclared ratios of the bar count N:
 *
 *   |——— eval region (N − holdoutBars) ———|— HOLDOUT —|
 *   |— IS window —|— step —|— step —| …    max(30, 20% of N)
 *
 *   - The HOLDOUT is the most recent slice and is structurally separated
 *     from selection: no selection run ever sees holdout bars (every leg
 *     slice is cut by INDEX out of the eval region, so a leg cannot even
 *     accidentally fill from a holdout bar — fills resolve by timestamp
 *     within the slice it is given), and the pooled winner is replayed on
 *     the holdout slice ONCE, cold, at the end. A promotion review reads
 *     the holdout metrics, never the OOS sheet.
 *   - Walk-forward: fold f trains every grid candidate IN-SAMPLE on
 *     eval[f·S … f·S + W) and replays the fold's winner COLD — a fresh
 *     strategy instance per leg, no indicator carry-over — on
 *     eval[f·S + W … f·S + W + S) (the last step absorbs the remainder).
 *     Every eval bar after the first IS window serves as out-of-sample
 *     data exactly once, and each fold's OOS span comes strictly after its
 *     own IS span.
 *   - The POOLED winner (most fold spans won; ties by mean IS equity, then
 *     grid order) drives the holdout replay.
 *
 * The tuning set (everything before the holdout) is never mutated — the
 * module is pure — so a later learned-gate change (§8) is evaluated on a
 * NEW layout cut, never a re-read of this one.
 *
 * Pure: no clock, no DB, no network. The caller (route) supplies verified
 * datasets — this module never loads or trusts unverified bytes.
 */

/** In-sample share of the eval region — predeclared, not tuned per run. */
const TRAIN_RATIO = 0.6;
/** Holdout share of the FULL dataset (with a floor). */
const HOLDOUT_RATIO = 0.2;
/** Minimum in-sample bars to score candidates at all. */
const MIN_TRAIN_BARS = 50;
/** Minimum bars per OOS step: below this, legs barely act. */
const MIN_STEP_BARS = 30;
/** Minimum holdout bars for a single cold replay to mean anything. */
const MIN_HOLDOUT_BARS = 30;

/** Sentiment trailing window: 7d, same as ingestion/live parity. */
const SENTIMENT_WINDOW_MS = 7 * 24 * 3_600_000;

export interface WalkForwardCandidateScore {
  metrics: BacktestMetrics;
  params: SmaGridParams;
}

export interface WalkForwardLeg {
  /** In-sample span this leg's winner was selected on, epoch ms. */
  inSampleWindow: { endMs: number; startMs: number };
  /** Out-of-sample span the winner was replayed on, epoch ms. */
  outOfSampleWindow: { endMs: number; startMs: number };
  /** The exact slice identities — pin into the promotion record. */
  sliceHashes: {
    /** The OOS bars slice the winner was replayed on. */
    bars: string;
    /** The IS bars slice candidates were scored on. */
    inSampleBars: string;
    /** The IS sentiment slice (null when the dataset has no sentiment). */
    inSampleSentiment: string | null;
    /** The OOS sentiment slice (null when the dataset has no sentiment). */
    sentiment: string | null;
  };
  /** Every candidate's IS score, in grid order (for the record). */
  selection: WalkForwardCandidateScore[];
  /** The winning IS score (repeated from `selection` for convenience). */
  winner: WalkForwardCandidateScore;
  /** The winner's cold OOS replay. */
  oos: BacktestMetrics;
}

export interface WalkForwardHoldoutResult {
  /** The cold replay of the pooled winner on the untouched holdout slice. */
  metrics: BacktestMetrics;
  sliceHashes: { bars: string; sentiment: string | null };
  window: { endMs: number; startMs: number };
}

export interface WalkForwardRun {
  /** Pooled OOS arithmetic across legs (each leg restarts at full capital). */
  aggregate: {
    /** (Σ leg endEquity − capital·legs) / (capital·legs), percent. */
    endEquityPct: number;
    legs: number;
    maxDrawdown: number;
    positiveLegs: number;
    totalFees: number;
    trades: number;
    /** Mean of the legs' win rates; null when no leg closed a trade. */
    winRate: number | null;
  };
  /** Identity of the FULL datasets consumed (matches the store hashes). */
  datasetHashes: BacktestDatasetIdentity;
  endMs: number;
  holdout: WalkForwardHoldoutResult;
  legs: WalkForwardLeg[];
  selectionAggregate: {
    /** Most fold spans won; ties by mean IS equity, then grid order. */
    winner: { params: SmaGridParams; spansWon: number };
  };
  startMs: number;
}

export interface WalkForwardConfig {
  capital: number;
  decisionIntervalMs: number;
  /** Number of walk-forward steps (>= 2). */
  folds: number;
  /** The PREDECLARED grid to search — never widened after seeing results. */
  grid: readonly SmaGridParams[];
  /** Sentiment gate params for the reference strategy. */
  sentimentGate?: { minSocialVolume?: number; sentimentEdge?: number };
  sizingPct: number;
  simulation: SimulationConfig;
}

function assertConfig(config: WalkForwardConfig): void {
  if (
    !Number.isInteger(config.folds) ||
    config.folds < 2 ||
    config.folds > 12
  ) {
    throw new Error("walk-forward folds must be an integer in [2, 12]");
  }
  if (config.grid.length === 0) {
    throw new Error("walk-forward grid must not be empty");
  }
  const seen = new Set<string>();
  for (const p of config.grid) {
    if (!(p.fast > 0 && p.slow > p.fast)) {
      throw new Error("walk-forward grid params must satisfy 0 < fast < slow");
    }
    const key = `${p.fast}/${p.slow}`;
    if (seen.has(key)) {
      throw new Error(`walk-forward grid contains a duplicate: ${key}`);
    }
    seen.add(key);
  }
  if (!(config.capital > 0) || !Number.isFinite(config.capital)) {
    throw new Error("walk-forward capital must be a positive finite number");
  }
  if (!(config.sizingPct > 0 && config.sizingPct <= 1)) {
    throw new Error("walk-forward sizingPct must be in (0, 1]");
  }
}

/**
 * Sentiment pre-sliced to a span [startMs, endMs): keeps the trailing
 * pre-span stamps (so the first in-span reading matches a fresh historical
 * read — full trailing-window semantics) and REMOVES everything at/after
 * the span end — never present-but-future, so even a semantics slip could
 * not leak.
 */
function sliceSentimentForSpan(
  dataset: PitDataset<PitSentimentValue>,
  startMs: number,
  endMs: number,
): PitDataset<PitSentimentValue> {
  const warmupStart = startMs - SENTIMENT_WINDOW_MS;
  return {
    asset: dataset.asset,
    points: dataset.points.filter(
      (p) => p.asOf >= warmupStart && p.asOf < endMs,
    ),
  };
}

/**
 * Run the walk-forward evaluation over an already-verified dataset.
 * See the module docstring for the layout contract.
 */
export function runWalkForward(input: {
  bars: PitDataset<SimulationBar>;
  config: WalkForwardConfig;
  sentiment?: PitDataset<PitSentimentValue> | null;
}): WalkForwardRun {
  assertConfig(input.config);

  const allPoints = input.bars.points;
  if (allPoints.length === 0) {
    throw new Error("walk-forward refuses an empty bar dataset");
  }
  const firstStamp = allPoints[0].asOf;
  const lastStamp = allPoints[allPoints.length - 1].asOf;
  const totalBars = allPoints.length;

  // ---- Layout: holdout tail, then walk-forward over the eval region ------
  const holdoutBars = Math.max(
    MIN_HOLDOUT_BARS,
    Math.floor(totalBars * HOLDOUT_RATIO),
  );
  const evalBars = totalBars - holdoutBars;
  if (evalBars <= 0) {
    throw new Error(
      `walk-forward needs more than the ${MIN_HOLDOUT_BARS}-bar holdout minimum; the dataset has ${totalBars} bars`,
    );
  }
  const evalPoints = allPoints.slice(0, evalBars);
  const holdoutPoints = allPoints.slice(evalBars);

  const trainWindowBars = Math.floor(evalBars * TRAIN_RATIO);
  if (trainWindowBars < MIN_TRAIN_BARS) {
    throw new Error(
      `walk-forward needs at least ${MIN_TRAIN_BARS} in-sample bars; the eval region yields ${trainWindowBars} of ${evalBars}`,
    );
  }
  const stepBars = Math.floor(
    (evalBars - trainWindowBars) / input.config.folds,
  );
  if (stepBars < MIN_STEP_BARS) {
    throw new Error(
      `walk-forward needs at least ${MIN_STEP_BARS} bars per out-of-sample step; ${input.config.folds} folds over ${evalBars} eval bars yield ${stepBars}`,
    );
  }

  const { capital, decisionIntervalMs, sizingPct, simulation } = input.config;
  const gateOpts = {
    minSocialVolume: input.config.sentimentGate?.minSocialVolume ?? 0,
    sentimentEdge: input.config.sentimentGate?.sentimentEdge ?? 0.02,
  };
  // Grid position — the final winner tie-break after spansWon and mean IS
  // equity is the earliest grid position.
  const gridOrder = new Map<string, number>();
  input.config.grid.forEach((p, i) => {
    gridOrder.set(`${p.fast}/${p.slow}`, i);
  });

  const legs: WalkForwardLeg[] = [];
  for (let f = 0; f < input.config.folds; f += 1) {
    const isFrom = f * stepBars;
    const isTo = isFrom + trainWindowBars;
    const oosFrom = isTo;
    const oosTo =
      f === input.config.folds - 1
        ? evalBars // last step absorbs the remainder
        : oosFrom + stepBars;

    // Index-cut slices out of the eval region — the isolation guarantee.
    const isSlicePoints = evalPoints.slice(isFrom, isTo);
    const oosSlicePoints = evalPoints.slice(oosFrom, oosTo);
    const isStartMs = isSlicePoints[0].asOf;
    const isEndMs = isSlicePoints[isSlicePoints.length - 1].asOf;
    const oosStartMs = oosSlicePoints[0].asOf;
    const oosEndMs = oosSlicePoints[oosSlicePoints.length - 1].asOf;

    const isBars: PitDataset<SimulationBar> = {
      asset: input.bars.asset,
      points: isSlicePoints,
    };
    const isBarsHash = hashPitDataset(isBars);
    // The sentiment slice ends at the IS span end: decisions during
    // selection see only selection-window sentiment.
    const isSentiment = input.sentiment
      ? sliceSentimentForSpan(input.sentiment, isStartMs, isEndMs + 1)
      : null;
    const isSentimentHash = isSentiment ? hashPitDataset(isSentiment) : null;

    // ---- In-sample: score every candidate on this fold's train span -----
    const selection: WalkForwardCandidateScore[] = input.config.grid.map(
      (params) => {
        const run = runBacktest({
          bars: isBars,
          config: {
            capital,
            decisionIntervalMs,
            sizingPct,
            simulation,
            strategy: createSmaMomentumStrategy({
              ...gateOpts,
              fast: params.fast,
              slow: params.slow,
            }),
          },
          identity: { bars: isBarsHash, sentiment: isSentimentHash },
          sentiment: isSentiment,
        });
        return { metrics: run.metrics, params: { ...params } };
      },
    );

    // Winner: highest IS endEquity; ties by grid order (stable sort).
    const winner = [...selection].sort(
      (a, b) =>
        b.metrics.endEquity - a.metrics.endEquity ||
        (gridOrder.get(`${a.params.fast}/${a.params.slow}`) ?? 0) -
          (gridOrder.get(`${b.params.fast}/${b.params.slow}`) ?? 0),
    )[0];

    // ---- Out-of-sample: replay the winner COLD on the next step ---------
    const oosBars: PitDataset<SimulationBar> = {
      asset: input.bars.asset,
      points: oosSlicePoints,
    };
    const oosBarsHash = hashPitDataset(oosBars);
    const oosSentiment = input.sentiment
      ? sliceSentimentForSpan(input.sentiment, oosStartMs, oosEndMs + 1)
      : null;
    const oosSentimentHash = oosSentiment ? hashPitDataset(oosSentiment) : null;

    const oosRun = runBacktest({
      bars: oosBars,
      config: {
        capital,
        decisionIntervalMs,
        sizingPct,
        simulation,
        strategy: createSmaMomentumStrategy({
          ...gateOpts,
          fast: winner.params.fast,
          slow: winner.params.slow,
        }),
      },
      identity: { bars: oosBarsHash, sentiment: oosSentimentHash },
      sentiment: oosSentiment,
    });

    legs.push({
      inSampleWindow: { endMs: isEndMs, startMs: isStartMs },
      oos: oosRun.metrics,
      outOfSampleWindow: { endMs: oosEndMs, startMs: oosStartMs },
      selection,
      sliceHashes: {
        bars: oosBarsHash,
        inSampleBars: isBarsHash,
        inSampleSentiment: isSentimentHash,
        sentiment: oosSentimentHash,
      },
      winner,
    });
  }

  // ---- Pooled IS winner across legs ---------------------------------------
  // Iterating in grid order makes the final tie-break (equal spansWon and
  // equal mean IS equity) fall to the earliest grid position.
  const stats = input.config.grid.map((params) => ({
    meanIsEquity: -Infinity,
    params,
    spansWon: 0,
    scoreSum: 0,
  }));
  const byKey = new Map(
    stats.map((s) => [`${s.params.fast}/${s.params.slow}`, s]),
  );
  for (const leg of legs) {
    const stat = byKey.get(
      `${leg.winner.params.fast}/${leg.winner.params.slow}`,
    );
    if (!stat) {
      throw new Error("walk-forward fold winner came from outside the grid");
    }
    stat.spansWon += 1;
    const isScore = leg.selection.find(
      (c) =>
        c.params.fast === leg.winner.params.fast &&
        c.params.slow === leg.winner.params.slow,
    );
    stat.scoreSum += isScore?.metrics.endEquity ?? 0;
  }
  let aggregateWinner = stats[0];
  for (const stat of stats) {
    stat.meanIsEquity =
      stat.spansWon > 0 ? stat.scoreSum / stat.spansWon : -Infinity;
    if (
      stat.spansWon > aggregateWinner.spansWon ||
      (stat.spansWon === aggregateWinner.spansWon &&
        stat.meanIsEquity > aggregateWinner.meanIsEquity)
    ) {
      aggregateWinner = stat;
    }
  }
  if (aggregateWinner.spansWon === 0) {
    throw new Error("walk-forward produced no fold winners");
  }

  // ---- The untouched holdout: ONE cold replay of the pooled winner -------
  const holdoutStartMs = holdoutPoints[0].asOf;
  const holdoutEndMs = holdoutPoints[holdoutPoints.length - 1].asOf;
  const holdoutBarsDataset: PitDataset<SimulationBar> = {
    asset: input.bars.asset,
    points: holdoutPoints,
  };
  const holdoutBarsHash = hashPitDataset(holdoutBarsDataset);
  const holdoutSentiment = input.sentiment
    ? sliceSentimentForSpan(input.sentiment, holdoutStartMs, holdoutEndMs + 1)
    : null;
  const holdoutSentimentHash = holdoutSentiment
    ? hashPitDataset(holdoutSentiment)
    : null;

  const holdoutRun = runBacktest({
    bars: holdoutBarsDataset,
    config: {
      capital,
      decisionIntervalMs,
      sizingPct,
      simulation,
      strategy: createSmaMomentumStrategy({
        ...gateOpts,
        fast: aggregateWinner.params.fast,
        slow: aggregateWinner.params.slow,
      }),
    },
    identity: { bars: holdoutBarsHash, sentiment: holdoutSentimentHash },
    sentiment: holdoutSentiment,
  });

  // ---- Pooled OOS aggregate ----------------------------------------------
  const positiveLegs = legs.filter((leg) => leg.oos.endEquity > capital);
  const winRateInputs = legs
    .map((leg) => leg.oos.winRate)
    .filter((wr): wr is number => wr !== null);
  const totalEndEquity = legs.reduce((sum, leg) => sum + leg.oos.endEquity, 0);
  const capitalDeployed = capital * legs.length;

  return {
    aggregate: {
      endEquityPct: Number(
        (((totalEndEquity - capitalDeployed) / capitalDeployed) * 100).toFixed(
          4,
        ),
      ),
      legs: legs.length,
      maxDrawdown: Number(
        Math.max(...legs.map((leg) => leg.oos.maxDrawdown), 0).toFixed(8),
      ),
      positiveLegs: positiveLegs.length,
      totalFees: Number(
        legs.reduce((sum, leg) => sum + leg.oos.totalFees, 0).toFixed(8),
      ),
      trades: legs.reduce((sum, leg) => sum + leg.oos.tradeCount, 0),
      winRate:
        winRateInputs.length > 0
          ? Number(
              (
                winRateInputs.reduce((a, b) => a + b, 0) / winRateInputs.length
              ).toFixed(4),
            )
          : null,
    },
    datasetHashes: {
      bars: hashPitDataset(input.bars),
      sentiment: input.sentiment ? hashPitDataset(input.sentiment) : null,
    },
    endMs: lastStamp,
    holdout: {
      metrics: holdoutRun.metrics,
      sliceHashes: {
        bars: holdoutBarsHash,
        sentiment: holdoutSentimentHash,
      },
      window: { endMs: holdoutEndMs, startMs: holdoutStartMs },
    },
    legs,
    selectionAggregate: {
      winner: {
        params: { ...aggregateWinner.params },
        spansWon: aggregateWinner.spansWon,
      },
    },
    startMs: firstStamp,
  };
}
