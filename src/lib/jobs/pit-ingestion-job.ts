import { and, desc, eq, gte, inArray, lte } from "drizzle-orm";
import vaderSentiment from "vader-sentiment";
import {
  createPitDataset,
  hashPitDataset,
  type PitDataset,
  type PitPoint,
  type PitSentimentObservation,
  pitSentimentFromObservations,
} from "@/ai/capital-engine/point-in-time";
import type { SimulationBar } from "@/ai/capital-engine/simulation";
import { alpacaClient } from "@/channels/alpaca/client";
import { isKnownBroker } from "@/channels/broker/registry";
import { db } from "@/db";
import { pitDatasets } from "@/db/schema/backtest";
import { runtimeSettings } from "@/db/schema/trading";
import { scraperDb } from "@/db/scraper-index";
import { scrapedMessages } from "@/db/scraper-schema";
import { getBrokerCredentials } from "@/lib/broker-credentials";
import { log } from "@/lib/evlog";

/**
 * Historical dataset ingestion into the point-in-time contract (checklist
 * §7 — the "REMAINS PENDING" half of the PIT item).
 *
 * Flow:
 *   1. resolve the window: requested range, or the default (last N days
 *      ending at the last clock hour — never a partial current hour);
 *   2. fetch broker historical bars (paginated, ascending) and convert
 *      them into a PIT dataset via the typed contract
 *      (src/ai/capital-engine/point-in-time.ts);
 *   3. persist the dataset durably (pit_datasets, hash-keyed) — a backtest
 *      pins `hashPitDataset` into its promotion record, and any later run
 *      can prove it consumed the SAME bytes;
 *   4. hand the caller the dataset + the simulator's bar view.
 *
 * Ingestion is idempotent: the same (asset, broker, window) returns the
 * cached dataset. Rows are never edited — a longer window appends a NEW
 * dataset version (new hash), preserving reproducibility of older runs
 * against their pinned hash.
 *
 * Only the Alpaca data feed is wired for historical bars (the OKX adapter
 * exposes no historical endpoint), and ingestion refuses to store a
 * "thin" dataset — too few bars to be meaningful backtest evidence.
 */

const PIT_INGESTION_SOURCE = "broker-historical-bars";

/** Min bars expected per requested window — below this, ingestion refuses. */
const MIN_BARS_FOR_WINDOW = 24;

export interface PitIngestionResult {
  asset: string;
  /** The broker that served the bars (null when none could). */
  brokerId: string | null;
  /** Canonical hash of the stored/loaded dataset (null when not ingested). */
  datasetHash: string | null;
  barCount: number;
  /** True when an existing cached dataset covered the window. */
  reused: boolean;
  window: { endMs: number; startMs: number } | null;
  /** Dataset axis ingested. */
  kind: "bars" | "sentiment";
}

interface StoredDataset {
  asset: string;
  dataset: { asset: string; points: Array<PitPoint<SimulationBar>> };
  datasetHash: string;
}

/** Validate a stored jsonb payload before trusting it as a PIT dataset. */
function parseStoredDataset(raw: unknown): StoredDataset | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const candidate = raw as Partial<StoredDataset>;
  if (
    typeof candidate.asset !== "string" ||
    typeof candidate.datasetHash !== "string" ||
    !candidate.dataset ||
    !Array.isArray(candidate.dataset.points)
  ) {
    return null;
  }
  try {
    // A cache hit must be an internally valid PIT dataset (sorted, sane).
    createPitDataset<SimulationBar>({
      asset: candidate.dataset.asset,
      points: candidate.dataset.points,
    });
  } catch {
    return null;
  }
  return candidate as StoredDataset;
}

/** Resolve the default window: the last N days ending at the last hour. */
export function defaultIngestionWindow(days = 14): {
  endMs: number;
  startMs: number;
} {
  const end = new Date();
  end.setMinutes(0, 0, 0);
  return {
    endMs: end.getTime(),
    startMs: end.getTime() - days * 24 * 3_600_000,
  };
}

/** Map the project's base-asset convention onto the Alpaca symbol. */
function alpacaSymbolFor(asset: string): string {
  const base = asset.split(/[-/]/)[0]?.toUpperCase();
  if (!base) {
    throw new Error(`Invalid asset: ${asset}`);
  }
  // Crypto majors exist on the Alpaca crypto feed as BASE/USD; equities
  // use the bare ticker.
  const CRYPTO = new Set(["BTC", "DOGE", "ETH", "SOL", "XRP"]);
  return CRYPTO.has(base) ? `${base}/USD` : base;
}

/**
 * Run one ingestion pass for one asset. Fails closed: an unsupported
 * active broker, missing credentials, unreadable bars, or a window too
 * thin to be useful all refuse rather than storing a misleading dataset.
 */
export async function runPitIngestion(input: {
  asset: string;
  days?: number;
  endMs?: number;
  startMs?: number;
}): Promise<PitIngestionResult> {
  const window = input.startMs
    ? { endMs: input.endMs ?? Date.now(), startMs: input.startMs }
    : defaultIngestionWindow(input.days);

  const [settingsRow] = await db
    .select({ activeBrokerId: runtimeSettings.activeBrokerId })
    .from(runtimeSettings)
    .where(eq(runtimeSettings.id, "global"))
    .limit(1);
  const brokerId = isKnownBroker(settingsRow?.activeBrokerId ?? "")
    ? settingsRow.activeBrokerId
    : "okx";

  if (brokerId !== "alpaca") {
    log.warn({
      asset: input.asset,
      brokerId,
      job: "pit-ingestion",
      warning: "active broker has no historical bars feed",
    });
    return {
      asset: input.asset,
      barCount: 0,
      brokerId: null,
      datasetHash: null,
      kind: "bars",
      reused: false,
      window: null,
    };
  }
  if (!(await getBrokerCredentials("alpaca"))) {
    throw new Error(
      "PIT ingestion requires Alpaca credentials (the only wired historical feed)",
    );
  }

  // Idempotent path: a cached dataset whose coverage spans the window wins.
  const [cachedRow] = await db
    .select({ dataset: pitDatasets.dataset })
    .from(pitDatasets)
    .where(
      and(
        eq(pitDatasets.asset, input.asset),
        eq(pitDatasets.brokerId, brokerId),
        lte(pitDatasets.windowStartMs, window.startMs),
        gte(pitDatasets.windowEndMs, window.endMs),
      ),
    )
    .orderBy(desc(pitDatasets.windowStartMs))
    .limit(1);
  const cached = parseStoredDataset(cachedRow?.dataset);
  if (cached) {
    return {
      asset: input.asset,
      barCount: cached.dataset.points.length,
      brokerId,
      datasetHash: cached.datasetHash,
      kind: "bars",
      reused: true,
      window,
    };
  }

  const bars = await alpacaClient.getHistoricalBars(
    alpacaSymbolFor(input.asset),
    window.startMs,
    window.endMs,
  );
  if (bars.length < MIN_BARS_FOR_WINDOW) {
    throw new Error(
      `PIT ingestion for ${input.asset}: only ${bars.length} bars returned for the window (need >= ${MIN_BARS_FOR_WINDOW}) — refusing to store a thin dataset`,
    );
  }

  // As-of stamp = bar open time; the bar itself is only known at/after its
  // open, so asOf = bar.t keeps the never-newer-than rule honest.
  const points: Array<PitPoint<SimulationBar>> = bars
    .map((bar) => ({
      asOf: new Date(bar.t).getTime(),
      source: PIT_INGESTION_SOURCE,
      validTo: null,
      value: {
        ask: Number((bar.c * 1.0002).toFixed(8)),
        bid: Number((bar.c * 0.9998).toFixed(8)),
        close: bar.c,
        high: bar.h,
        low: bar.l,
        open: bar.o,
        timestamp: new Date(bar.t).toISOString(),
        volume: bar.v,
      } satisfies SimulationBar,
    }))
    .sort((a, b) => a.asOf - b.asOf);

  const dataset: PitDataset<SimulationBar> = createPitDataset({
    asset: input.asset,
    points,
  });
  const datasetHash = hashPitDataset(dataset);

  await db
    .insert(pitDatasets)
    .values({
      asset: input.asset,
      brokerId,
      dataset: { asset: input.asset, points },
      datasetHash,
      kind: "bars",
      windowEndMs: window.endMs,
      windowStartMs: window.startMs,
    })
    .onConflictDoNothing({
      target: [
        pitDatasets.asset,
        pitDatasets.brokerId,
        pitDatasets.windowStartMs,
        pitDatasets.windowEndMs,
      ],
    });

  log.info({
    asset: input.asset,
    bars: points.length,
    datasetHash,
    job: "pit-ingestion",
    windowEnd: window.endMs,
    windowStart: window.startMs,
  });

  return {
    asset: input.asset,
    barCount: points.length,
    brokerId,
    datasetHash,
    kind: "bars",
    reused: false,
    window,
  };
}

/**
 * Ingest the news/sentiment axis into the PIT contract (the REMAINS-PENDING
 * half of the §7 PIT item).
 *
 * Source: the durable scraper archive (`scraped_messages`, the write-through
 * store the Reddit/news tools maintain). The as-of stamp is each message's
 * `fetchedAt` — when the SYSTEM observed it — never `postedAt`: a post
 * published at T enters our world only when our scraper fetched it, and a
 * backtest may only see what had been observed. Values recompute VADER on
 * the stored body (identically to the live `fetchMarketSignals` tool) and
 * aggregate over the trailing 7-day window via the pure
 * `pitSentimentFromObservations` adapter.
 *
 * The stored window is the archive's own observed stamp range — the stamps
 * DEFINE coverage; nothing else can. Rows are never edited: the same stamp
 * range later re-ingested with a bigger archive keeps the ORIGINAL bytes
 * (onConflictDoNothing), so backtests pinned to an older hash stay
 * reproducible.
 */
export async function runPitSentimentIngestion(input: {
  asset: string;
}): Promise<PitIngestionResult> {
  if (!scraperDb) {
    throw new Error(
      "PIT sentiment ingestion requires SCRAPER_DATABASE_URL (the durable news/reddit archive)",
    );
  }

  // The archive stores the asset exactly as the tools received it — cover
  // both the pair form ("BTC-USD") and the bare base ("BTC").
  const upper = input.asset.toUpperCase();
  const base = upper.split(/[-/]/)[0] ?? upper;
  const assetVariants = [...new Set([upper, base])];

  const rows = await scraperDb
    .select({
      body: scrapedMessages.body,
      externalId: scrapedMessages.externalId,
      fetchedAt: scrapedMessages.fetchedAt,
      sentimentScore: scrapedMessages.sentimentScore,
      source: scrapedMessages.source,
    })
    .from(scrapedMessages)
    .where(
      and(
        inArray(scrapedMessages.asset, assetVariants),
        inArray(scrapedMessages.source, ["reddit", "news"]),
      ),
    )
    .orderBy(scrapedMessages.fetchedAt);

  if (rows.length === 0) {
    throw new Error(
      `PIT sentiment ingestion for ${input.asset}: the scraper archive holds no reddit/news observations — trigger the scrape tools first (nothing is fabricated)`,
    );
  }

  const observations: PitSentimentObservation[] = rows.map((row) => ({
    externalId: row.externalId,
    fetchedAtMs: row.fetchedAt.getTime(),
    source: row.source === "reddit" ? "reddit" : "news",
    // Prefer the stored score when present; otherwise score now, exactly
    // like the live tool does on the same body text.
    vaderCompound:
      row.sentimentScore ??
      vaderSentiment.SentimentIntensityAnalyzer.polarity_scores(row.body)
        .compound,
  }));

  const dataset = pitSentimentFromObservations(input.asset, observations);
  if (!dataset) {
    throw new Error(
      `PIT sentiment ingestion for ${input.asset}: archive resolved to an empty dataset (nothing fabricated)`,
    );
  }
  const datasetHash = hashPitDataset(dataset);
  const stamps = dataset.points.map((p) => p.asOf);
  const windowStartMs = Math.min(...stamps);
  const windowEndMs = Math.max(...stamps);

  await db
    .insert(pitDatasets)
    .values({
      asset: input.asset,
      brokerId: "scraper-archive",
      dataset: { asset: input.asset, points: dataset.points },
      datasetHash,
      kind: "sentiment",
      windowEndMs,
      windowStartMs,
    })
    .onConflictDoNothing({
      target: [
        pitDatasets.asset,
        pitDatasets.brokerId,
        pitDatasets.windowStartMs,
        pitDatasets.windowEndMs,
      ],
    });

  log.info({
    asset: input.asset,
    datasetHash,
    job: "pit-ingestion",
    kind: "sentiment",
    observations: observations.length,
    points: dataset.points.length,
    windowEnd: windowEndMs,
    windowStart: windowStartMs,
  });

  return {
    asset: input.asset,
    barCount: dataset.points.length,
    brokerId: "scraper-archive",
    datasetHash,
    kind: "sentiment",
    reused: false,
    window: { endMs: windowEndMs, startMs: windowStartMs },
  };
}
