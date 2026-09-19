import { z } from "zod";
import { REFERENCE_SMA_GRID } from "@/ai/capital-engine/backtest-runner";
import {
  loadVerifiedBarDataset,
  loadVerifiedSentimentDataset,
  PitStoreError,
} from "@/ai/capital-engine/pit-store";
import { runWalkForward } from "@/ai/capital-engine/walk-forward";
import { getLogger, withEvlog } from "@/lib/evlog";
import { requireWriteAccess } from "@/lib/route-auth";

export const dynamic = "force-dynamic";

const walkForwardSchema = z.object({
  asset: z.string().min(1).max(20),
  capital: z.number().positive().max(1_000_000_000).default(10_000),
  decisionIntervalMs: z.number().int().min(60_000).default(3_600_000),
  folds: z.number().int().min(2).max(12).default(4),
  sizingPct: z.number().gt(0).lte(1).default(0.1),
});

/**
 * POST /api/jobs/walk-forward — walk-forward + untouched-holdout evaluation
 * over an INGESTED PIT dataset (checklist §7). Datasets are consumed ONLY
 * through the shared pit-store accessors (hash-verified before anything
 * runs — 404 without ingestion, 409 on corruption). The evaluation layout
 * is predeclared: the holdout is the most recent slice and selection never
 * sees it; the grid searched is the PUBLISHED REFERENCE_SMA_GRID — widening
 * it after seeing results would be data snooping, so a different grid is a
 * different evaluation, never a re-interpretation of this one. Returns the
 * per-leg OOS sheet, the pooled winner, and the ONE cold holdout replay;
 * every slice is pinned by hash for the promotion record.
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
  const parsed = walkForwardSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      {
        detail: parsed.error.flatten(),
        error:
          "expected { asset: string, capital?: number, decisionIntervalMs?: >=60000, folds?: 2..12, sizingPct?: (0,1] }",
      },
      { status: 400 },
    );
  }

  try {
    const { asset } = parsed.data;

    const { dataset: bars, hash: barsHash } =
      await loadVerifiedBarDataset(asset);
    const verifiedSentiment = await loadVerifiedSentimentDataset(asset);

    const run = runWalkForward({
      bars,
      config: {
        capital: parsed.data.capital,
        decisionIntervalMs: parsed.data.decisionIntervalMs,
        folds: parsed.data.folds,
        grid: REFERENCE_SMA_GRID,
        sizingPct: parsed.data.sizingPct,
        simulation: {
          feeBps: 10,
          latencyBars: 1,
          maxParticipationRate: 0.1,
          slippageBps: 5,
        },
      },
      sentiment: verifiedSentiment?.dataset ?? null,
    });

    // Identity chain: the run's pinned dataset hashes must equal the
    // store-verified hashes the datasets were loaded with (same canonical
    // hashing — a divergence would mean the chain broke; refuse, never
    // return metrics over an untraceable identity).
    if (
      run.datasetHashes.bars !== barsHash ||
      run.datasetHashes.sentiment !== (verifiedSentiment?.hash ?? null)
    ) {
      throw new Error(
        "walk-forward dataset identity diverged from the verified store hashes — refusing to report",
      );
    }

    logger.set({
      audit: "walk_forward_run",
      datasetHashes: run.datasetHashes,
      folds: run.aggregate.legs,
      holdoutEndEquity: run.holdout.metrics.endEquity,
      job: "walk-forward",
      pooledWinner: `${run.selectionAggregate.winner.params.fast}/${run.selectionAggregate.winner.params.slow}`,
      trades: run.aggregate.trades,
    });
    return Response.json({
      ...run,
      note: "Walk-forward evaluation over the PREDECLARED reference grid (SMA momentum, sentiment-gated). The holdout slice was never seen during selection — read its metrics, not the OOS sheet, when judging the winner. Pin datasetHashes + per-leg sliceHashes into the promotion record. Infrastructure validation, not an alpha claim.",
    });
  } catch (error) {
    if (error instanceof PitStoreError) {
      // Fail closed on store-level refusals: 404 without ingestion, 409 on
      // hash corruption, 500 on malformed rows — never run unverified bytes.
      logger.set({ job: "walk-forward", warning: error.message });
      return Response.json(
        { detail: error.detail, error: error.message },
        { status: error.status },
      );
    }
    const message =
      error instanceof Error ? error.message : "walk-forward run failed";
    logger.set({ job: "walk-forward", warning: message });
    return Response.json({ error: message }, { status: 502 });
  }
});
