import { z } from "zod";
import {
  type BacktestDatasetIdentity,
  createSmaMomentumStrategy,
  runBacktest,
} from "@/ai/capital-engine/backtest-runner";
import {
  loadVerifiedBarDataset,
  loadVerifiedSentimentDataset,
  PitStoreError,
} from "@/ai/capital-engine/pit-store";
import { getLogger, withEvlog } from "@/lib/evlog";
import { requireWriteAccess } from "@/lib/route-auth";

export const dynamic = "force-dynamic";

const backtestSchema = z.object({
  asset: z.string().min(1).max(20),
  capital: z.number().positive().max(1_000_000_000).default(10_000),
  decisionIntervalMs: z.number().int().min(60_000).default(3_600_000),
  sizingPct: z.number().gt(0).lte(1).default(0.1),
});

/**
 * POST /api/jobs/backtest — drive the first backtest over an INGESTED PIT
 * dataset (checklist §7). Datasets are consumed ONLY through the shared
 * pit-store accessors, which load the stored bars dataset for (asset,
 * alpaca) plus the sentiment dataset when present and verify each against
 * its pinned hash (a stored row that no longer hashes to its own
 * `datasetHash` is corruption — refuse, never run on unverified bytes).
 * The pure runner then executes with the reference SMA-momentum/
 * sentiment-gate strategy, and the route returns metrics + both dataset
 * hashes for the future promotion record.
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

    const { dataset: bars, hash: barsHash } =
      await loadVerifiedBarDataset(asset);
    const verifiedSentiment = await loadVerifiedSentimentDataset(asset);

    const identity: BacktestDatasetIdentity = {
      bars: barsHash,
      sentiment: verifiedSentiment?.hash ?? null,
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
      sentiment: verifiedSentiment?.dataset ?? null,
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
    if (error instanceof PitStoreError) {
      // Fail closed on store-level refusals: 404 without ingestion, 409 on
      // hash corruption, 500 on malformed rows — never run unverified bytes.
      logger.set({ job: "backtest", warning: error.message });
      return Response.json(
        { detail: error.detail, error: error.message },
        { status: error.status },
      );
    }
    const message =
      error instanceof Error ? error.message : "backtest run failed";
    logger.set({ job: "backtest", warning: message });
    return Response.json({ error: message }, { status: 502 });
  }
});
