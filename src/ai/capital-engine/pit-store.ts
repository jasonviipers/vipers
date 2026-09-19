import { and, desc, eq } from "drizzle-orm";
import type { PitSentimentValue } from "@/ai/capital-engine/point-in-time";
import {
  hashPitDataset,
  type PitDataset,
} from "@/ai/capital-engine/point-in-time";
import type { SimulationBar } from "@/ai/capital-engine/simulation";
import { db } from "@/db";
import { pitDatasets } from "@/db/schema/backtest";

/**
 * Shared accessor for ingested PIT datasets (bars / sentiment) with
 * integrity verification: a stored row that no longer hashes to its own
 * pinned `datasetHash` is corruption — callers get a typed error, never a
 * run over unverified bytes. Both the backtest route and the walk-forward /
 * holdout evaluation route consume datasets ONLY through this module.
 */

export class PitStoreError extends Error {
  readonly status: number;
  readonly detail?: Record<string, unknown>;

  constructor(
    message: string,
    status: number,
    detail?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "PitStoreError";
    this.status = status;
    this.detail = detail;
  }
}

/** kind → the brokerId convention rows are stored under. */
export function brokerIdForKind(kind: "bars" | "sentiment"): string {
  return kind === "sentiment" ? "scraper-archive" : "alpaca";
}

interface StoredDataset<T> {
  dataset: { asset: string; points: PitDataset<T>["points"] };
  datasetHash: string;
}

function loadStored<T>(raw: unknown, asset: string): PitDataset<T> {
  const stored = raw as StoredDataset<T> | null;
  if (
    !stored ||
    !stored.dataset ||
    !Array.isArray(stored.dataset.points) ||
    typeof stored.datasetHash !== "string"
  ) {
    throw new PitStoreError(
      `stored ${asset} dataset row is malformed — re-ingest it`,
      500,
    );
  }
  return { asset, points: stored.dataset.points };
}

/** The latest ingested bar dataset for an asset, hash-verified. */
export async function loadVerifiedBarDataset(
  asset: string,
): Promise<{ dataset: PitDataset<SimulationBar>; hash: string }> {
  const [row] = await db
    .select({
      dataset: pitDatasets.dataset,
      datasetHash: pitDatasets.datasetHash,
    })
    .from(pitDatasets)
    .where(
      and(
        eq(pitDatasets.asset, asset),
        eq(pitDatasets.brokerId, brokerIdForKind("bars")),
        eq(pitDatasets.kind, "bars"),
      ),
    )
    .orderBy(desc(pitDatasets.windowStartMs))
    .limit(1);

  if (!row) {
    throw new PitStoreError(
      `no ingested PIT bar dataset for ${asset} — POST /api/jobs/pit-ingestion first`,
      404,
    );
  }

  const dataset = loadStored<SimulationBar>(row.dataset, asset);
  const hash = hashPitDataset(dataset);
  if (hash !== row.datasetHash) {
    throw new PitStoreError(
      "stored bar dataset failed its pinned hash — refusing to run",
      409,
      { expected: row.datasetHash, got: hash },
    );
  }
  return { dataset, hash };
}

/**
 * The latest ingested sentiment dataset for an asset, hash-verified.
 * Returns null when none was ever ingested (sentiment is optional context).
 */
export async function loadVerifiedSentimentDataset(
  asset: string,
): Promise<{ dataset: PitDataset<PitSentimentValue>; hash: string } | null> {
  const [row] = await db
    .select({
      dataset: pitDatasets.dataset,
      datasetHash: pitDatasets.datasetHash,
    })
    .from(pitDatasets)
    .where(
      and(
        eq(pitDatasets.asset, asset),
        eq(pitDatasets.brokerId, brokerIdForKind("sentiment")),
        eq(pitDatasets.kind, "sentiment"),
      ),
    )
    .orderBy(desc(pitDatasets.windowStartMs))
    .limit(1);

  if (!row) {
    return null;
  }

  const dataset = loadStored<PitSentimentValue>(row.dataset, asset);
  const hash = hashPitDataset(dataset);
  if (hash !== row.datasetHash) {
    throw new PitStoreError(
      "stored sentiment dataset failed its pinned hash — refusing to run",
      409,
      { expected: row.datasetHash, got: hash },
    );
  }
  return { dataset, hash };
}
