import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import {
  type BacktestDatasetIdentity,
  createSmaMomentumStrategy,
  runBacktest,
} from "@/ai/capital-engine/backtest-runner";
import type { PitSentimentValue } from "@/ai/capital-engine/point-in-time";
import {
  hashPitDataset,
  type PitDataset,
} from "@/ai/capital-engine/point-in-time";
import type { SimulationBar } from "@/ai/capital-engine/simulation";
import { db } from "@/db";
import { pitDatasets } from "@/db/schema/backtest";
import { getLogger, withEvlog } from "@/lib/evlog";
import { requireWriteAccess } from "@/lib/route-auth";

export const dynamic = "force-dynamic";

const backtestSchema = z.object({
  asset: z.string().min(1).max(20),
  capital: z.number().positive().max(1_000_000_000).default(10_000),
  decisionIntervalMs: z.number().int().min(60_000).default(3_600_000),
  sizingPct: z.number().gt(0).lte(1).default(0.1),
});

interface StoredDataset {
  asset: string;
  dataset: { asset: string; points: PitDataset<SimulationBar>["points"] };
  datasetHash: string;
}

/**
 * POST /api/jobs/backtest — drive the first backtest over an INGESTED PIT
 * dataset (checklist §7). Reads the stored bars dataset for (asset, alpaca)
 * plus the sentiment dataset when present, verifies every stored dataset
 * against its pinned hash (a stored row that no longer hashes to its own
 * `datasetHash` is corruption — refuse, never run on unverified bytes), runs
 * the pure runner with the reference SMA-momentum/sentiment-gate strategy,
 * and returns metrics + both dataset hashes for the future promotion record.
 *
 * Read-only over ingested data: no orders, no ledger writes, no broker calls.
 */
export const POST = withEvlog(async (request: Request) => {
  const logger = getLogger();
  logger.set({ integration: "jobs" });

  const auth = requireWriteAccess(request);
  if (!auth.ok) {
    return auth.response;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const parsed = backtestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      {
        detail: parsed.error.flatten(),
        error:
          "expected { asset: string, capital?: number, decisionIntervalMs?: >=60000, sizingPct?: (0,1] }",
      },
      { status: 400 },
    );
  }

  try {
    const { asset } = parsed.data;

    const [barRow] = await db
      .select({
        dataset: pitDatasets.dataset,
        datasetHash: pitDatasets.datasetHash,
      })
      .from(pitDatasets)
      .where(eqDataset(asset, "bars"))
      .orderBy(desc(pitDatasets.windowStartMs))
      .limit(1);
    if (!barRow) {
      return Response.json(
        {
          error: `no ingested PIT bar dataset for ${asset} — POST /api/jobs/pit-ingestion first`,
        },
        { status: 404 },
      );
    }
    const stored = barRow.dataset as StoredDataset["dataset"];
    const bars: PitDataset<SimulationBar> = {
      asset,
      points: stored.points,
    };
    const barsHash = hashPitDataset(bars);
    if (barsHash !== barRow.datasetHash) {
      return Response.json(
        {
          detail: { expected: barRow.datasetHash, got: barsHash },
          error: "stored bar dataset failed its pinned hash — refusing to run",
        },
        { status: 409 },
      );
    }

    const [sentimentRow] = await db
      .select({
        dataset: pitDatasets.dataset,
        datasetHash: pitDatasets.datasetHash,
      })
      .from(pitDatasets)
      .where(eqDataset(asset, "sentiment"))
      .orderBy(desc(pitDatasets.windowStartMs))
      .limit(1);

    let sentiment: PitDataset<PitSentimentValue> | null = null;
    let sentimentHash: string | null = null;
    if (sentimentRow) {
      const sStored = sentimentRow.dataset as {
        points: PitDataset<PitSentimentValue>["points"];
      };
      sentiment = { asset, points: sStored.points };
      sentimentHash = hashPitDataset(sentiment);
      if (sentimentHash !== sentimentRow.datasetHash) {
        return Response.json(
          {
            detail: { expected: sentimentRow.datasetHash, got: sentimentHash },
            error:
              "stored sentiment dataset failed its pinned hash — refusing to run",
          },
          { status: 409 },
        );
      }
    }

    const identity: BacktestDatasetIdentity = {
      bars: barsHash,
      sentiment: sentimentHash,
    };
    const run = runBacktest({
      bars,
      config: {
        capital: parsed.data.capital,
        decisionIntervalMs: parsed.data.decisionIntervalMs,
        sizingPct: parsed.data.sizingPct,
        simulation: {
          feeBps: 10,
          latencyBars: 1,
          maxParticipationRate: 0.1,
          slippageBps: 5,
        },
        strategy: createSmaMomentumStrategy({ fast: 3, slow: 12 }),
      },
      identity,
      sentiment,
    });

    logger.set({
      audit: "backtest_run",
      datasetHashes: identity,
      job: "backtest",
      trades: run.metrics.tradeCount,
    });
    return Response.json({
      ...run,
      note: "Reference strategy (SMA 3/12 momentum, sentiment-gated). First-run infrastructure validation — not an alpha claim. Pin datasetHashes into the promotion record when promoting.",
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "backtest run failed";
    logger.set({ job: "backtest", warning: message });
    return Response.json({ error: message }, { status: 502 });
  }
});

/** (asset, kind) filter — kind maps onto the brokerId convention in the store. */
function eqDataset(asset: string, kind: "bars" | "sentiment") {
  return and(
    eq(pitDatasets.asset, asset),
    eq(
      pitDatasets.brokerId,
      kind === "sentiment" ? "scraper-archive" : "alpaca",
    ),
    eq(pitDatasets.kind, kind),
  );
}
