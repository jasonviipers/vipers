import { createHash } from "node:crypto";

import { canonicalise } from "./canonical-json";
import type { SimulationBar } from "./simulation";

/**
 * Point-in-time (PIT) market-data contract (checklist §7 — "Use
 * point-in-time market/news/fundamental data").
 *
 * A backtest is only honest when every decision sees exactly the data that
 * EXISTED at the decision moment. This module is the typed contract for
 * that: a dataset is an append-only step function of observations, each
 * valid from its `asOf` until the next observation supersedes it (or until
 * an explicit `validTo` — a retraction/delisting). The as-of reader refuses
 * (typed error, not null) any query before the dataset starts or into a
 * retracted gap: silently returning "nearest" data is precisely the
 * lookahead bias the PIT discipline exists to prevent.
 *
 * Pure and db-free: ingestion (historical datasets, replay capture) lands
 * here later; the simulator (simulation.ts) consumes bars converted through
 * `pitBarsFromSimulationBars`, and `hashPitDataset` pins the exact dataset
 * identity into promotion records.
 */

/** One observation: a fact about the world valid from `asOf` onward. */
export interface PitPoint<T> {
  /** Epoch ms — the moment this fact became known (never a future stamp). */
  asOf: number;
  /**
   * Epoch ms — when this fact stopped being valid (retraction, delisting,
   * restatement). Null/undefined: valid until superseded by the next point.
   */
  validTo?: number | null;
  /** Where the fact came from (venue, provider, dataset revision). */
  source: string;
  value: T;
}

export interface PitDataset<T> {
  asset: string;
  /** MUST be sorted strictly ascending by `asOf` (validated on creation). */
  points: Array<PitPoint<T>>;
}

/** Querying a dataset outside its known window — the lookahead-bias guard. */
export class PitLeakageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PitLeakageError";
  }
}

function assertFiniteEpoch(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`PIT ${name} must be a finite non-negative epoch ms`);
  }
}

/**
 * Validate and hold a dataset. Rejects unsorted/duplicate asOf stamps and
 * retractions that end before they begin — a dataset that ambiguous would
 * make as-of queries silently order-dependent.
 */
export function createPitDataset<T>(input: {
  asset: string;
  points: Array<PitPoint<T>>;
}): PitDataset<T> {
  if (!input.asset.trim()) {
    throw new Error("PIT dataset requires an asset identifier");
  }
  let previous: number | null = null;
  for (const point of input.points) {
    assertFiniteEpoch("asOf", point.asOf);
    if (
      point.validTo !== undefined &&
      point.validTo !== null &&
      (Number.isFinite(point.validTo) === false || point.validTo < 0)
    ) {
      throw new Error("PIT validTo must be a finite non-negative epoch ms");
    }
    if (point.validTo != null && point.validTo <= point.asOf) {
      throw new Error(
        "PIT validTo must be after asOf (a fact cannot end before it begins)",
      );
    }
    if (!point.source.trim()) {
      throw new Error("PIT point requires a source");
    }
    if (previous !== null && point.asOf <= previous) {
      throw new Error(
        "PIT points must be strictly ascending by asOf (duplicates are ambiguous)",
      );
    }
    previous = point.asOf;
  }
  return { asset: input.asset, points: input.points };
}

/**
 * The value of the dataset AS OF `at`: the latest observation stamped at or
 * before `at`, unless an explicit validTo retracted it earlier.
 *
 * Throws PitLeakageError when no fact existed yet at `at` (query before the
 * first stamp, or into a retracted gap) — callers treat that as missing
 * data, never as "use something newer".
 */
export function pitValueAt<T>(dataset: PitDataset<T>, at: number): PitPoint<T> {
  assertFiniteEpoch("query time", at);
  // Binary search: last index with points[i].asOf <= at.
  let low = 0;
  let high = dataset.points.length - 1;
  let found = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (dataset.points[mid].asOf <= at) {
      found = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  if (found === -1) {
    throw new PitLeakageError(
      `no ${dataset.asset} data existed at t=${at}: first stamp is ${
        dataset.points[0]?.asOf ?? "never"
      }`,
    );
  }
  const point = dataset.points[found];
  if (point.validTo != null && at >= point.validTo) {
    throw new PitLeakageError(
      `${dataset.asset} data as of t=${point.asOf} was retracted at t=${point.validTo} (queried t=${at})`,
    );
  }
  return point;
}

/** Convert simulator bars (chronological) into a PIT bar dataset. */
export function pitBarsFromSimulationBars(
  asset: string,
  bars: SimulationBar[],
): PitDataset<SimulationBar> {
  const parsed = bars.map((bar) => {
    const asOf = Date.parse(bar.timestamp);
    if (!Number.isFinite(asOf)) {
      throw new Error(
        `simulation bar has an unreadable timestamp: ${bar.timestamp}`,
      );
    }
    return { asOf, source: "simulation-bars", value: bar, validTo: null };
  });
  parsed.sort((a, b) => a.asOf - b.asOf);
  return createPitDataset({ asset, points: parsed });
}

/**
 * The bar AS OF the moment a decision was made — the value the simulator's
 * fill logic must be consistent with (its own `submittedAt` lookup follows
 * the same never-newer-than rule).
 */
export function pitBarAt(
  dataset: PitDataset<SimulationBar>,
  at: number,
): SimulationBar {
  return pitValueAt(dataset, at).value;
}

// ---------------------------------------------------------------------------
// News/sentiment axis. The same discipline as bars: a backtest decision may
// only see what the SYSTEM had observed at the decision moment. The as-of
// stamp is the OBSERVATION time (fetchedAt), never the post-authoring time —
// a post published at T enters our world only when our scraper fetched it.
// Values are aggregated over a trailing window exactly like the live
// fetchMarketSignals tool (count-weighted VADER on reddit + news, 0..1 unit
// scale), so a backtest reading is computed the same way a live reading was.
// ---------------------------------------------------------------------------

/** One archived message, pre-scored — the raw material for the sentiment axis. */
export interface PitSentimentObservation {
  externalId: string;
  /** Epoch ms — when the system fetched/observed the item (the as-of stamp). */
  fetchedAtMs: number;
  /** VADER compound for the body, −1..1, scored identically to the live tool. */
  source: "news" | "reddit";
  vaderCompound: number;
}

/** The sentiment reading a decision sees — parity with live MarketSignals. */
export interface PitSentimentValue {
  /** Observations in the trailing window, per source. */
  newsCount: number;
  redditCount: number;
  /** 0..1, 0.5 neutral — count-weighted combination, same formula as live. */
  sentimentScore: number;
  socialVolume: number;
}

const DEFAULT_SENTIMENT_WINDOW_MS = 7 * 24 * 3_600_000; // reddit searches t=week

/** Live-tool parity: VADER compound (−1..1) → unit scale (0..1, 0.5 neutral). */
function compoundToUnit(compound: number): number {
  return Number(((compound + 1) / 2).toFixed(3));
}

function windowAverageUnit(compounds: number[]): number {
  if (compounds.length === 0) {
    return 0.5;
  }
  const avg = compounds.reduce((a, b) => a + b, 0) / compounds.length;
  return compoundToUnit(avg);
}

/**
 * Build the sentiment PIT dataset from archived observations. Each distinct
 * fetchedAt stamp is one point whose value aggregates every observation
 * fetched in the trailing `windowMs` (default 7d) — arrivals in the same
 * scrape pass share one stamp and one point, keeping stamps strictly
 * ascending like every PIT dataset. Returns null for an empty archive (the
 * caller refuses, it never fabricates a neutral history).
 */
export function pitSentimentFromObservations(
  asset: string,
  observations: PitSentimentObservation[],
  opts?: { windowMs?: number },
): PitDataset<PitSentimentValue> | null {
  const windowMs = opts?.windowMs ?? DEFAULT_SENTIMENT_WINDOW_MS;
  if (!(windowMs > 0)) {
    throw new Error("sentiment windowMs must be positive");
  }

  // Dedupe (a message is one observation no matter how many passes saw it).
  const unique = new Map<string, PitSentimentObservation>();
  for (const o of observations) {
    if (!Number.isFinite(o.fetchedAtMs) || o.fetchedAtMs < 0) {
      throw new Error("sentiment observation has an invalid fetchedAt stamp");
    }
    unique.set(`${o.source}:${o.externalId}`, o);
  }
  if (unique.size === 0) {
    return null;
  }

  // Group arrivals by stamp, ascending — a batch arrival is one point.
  const byStamp = new Map<number, PitSentimentObservation[]>();
  for (const o of unique.values()) {
    const batch = byStamp.get(o.fetchedAtMs);
    if (batch) {
      batch.push(o);
    } else {
      byStamp.set(o.fetchedAtMs, [o]);
    }
  }
  const stamps = [...byStamp.keys()].sort((a, b) => a - b);

  const ordered = [...unique.values()].sort(
    (a, b) => a.fetchedAtMs - b.fetchedAtMs,
  );
  const points = stamps.map((stamp) => {
    // Trailing window (stamp − windowMs, stamp]: older observations age out.
    const inWindow = ordered.filter(
      (o) => o.fetchedAtMs <= stamp && o.fetchedAtMs > stamp - windowMs,
    );
    const reddit = inWindow.filter((o) => o.source === "reddit");
    const news = inWindow.filter((o) => o.source === "news");
    const redditScore = windowAverageUnit(reddit.map((o) => o.vaderCompound));
    const newsScore = windowAverageUnit(news.map((o) => o.vaderCompound));
    const total = reddit.length + news.length;
    const combined =
      total === 0
        ? 0.5
        : (redditScore * reddit.length + newsScore * news.length) / total;
    return {
      asOf: stamp,
      source: "scraper-archive-sentiment",
      validTo: null,
      value: {
        newsCount: news.length,
        redditCount: reddit.length,
        sentimentScore: Number(combined.toFixed(3)),
        socialVolume: total,
      } satisfies PitSentimentValue,
    };
  });

  return createPitDataset({ asset, points });
}

/**
 * Canonical sha256 over the dataset — pinning the EXACT data window a
 * backtest/walk-forward run used into its promotion record, so results are
 * reproducible against the same bytes and post-hoc dataset edits are
 * detectable.
 */
export function hashPitDataset<T>(dataset: PitDataset<T>): string {
  return createHash("sha256")
    .update(canonicalise({ asset: dataset.asset, points: dataset.points }))
    .digest("hex");
}
