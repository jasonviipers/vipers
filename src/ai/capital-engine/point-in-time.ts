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
