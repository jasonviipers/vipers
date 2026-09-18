import { z } from "zod";
import { getLogger, withEvlog } from "@/lib/evlog";
import {
  runPitIngestion,
  runPitSentimentIngestion,
} from "@/lib/jobs/pit-ingestion-job";
import { requireWriteAccess } from "@/lib/route-auth";

export const dynamic = "force-dynamic";

const ingestionSchema = z.object({
  asset: z.string().min(1).max(20),
  days: z.number().int().min(1).max(365).optional(),
  endMs: z.number().int().positive().optional(),
  /** Dataset axis: "bars" (broker historical, default) or "sentiment". */
  kind: z.enum(["bars", "sentiment"]).optional(),
  startMs: z.number().int().positive().optional(),
});

/**
 * POST /api/jobs/pit-ingestion — ingest historical bars into the
 * point-in-time dataset store for backtests/walk-forward runs.
 *
 * Body: { "asset": "BTC" | "AAPL" | ..., "days": 14 } or an explicit
 * { "startMs", "endMs" } window. Idempotent per (asset, window): an
 * existing cached dataset covering the window is returned unchanged
 * (`reused: true`) — stored datasets are never edited, so promotion
 * records pinned to a dataset hash stay reproducible.
 *
 * Fails closed: only the Alpaca historical feed is wired (the active
 * broker must be alpaca with stored credentials), and a window returning
 * fewer than 24 bars is refused rather than stored as thin evidence.
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

  const parsed = ingestionSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      {
        detail: parsed.error.flatten(),
        error: "expected { asset: string, days?: 1-365 | startMs?, endMs? }",
      },
      { status: 400 },
    );
  }

  try {
    const kind = parsed.data.kind ?? "bars";
    const result =
      kind === "sentiment"
        ? await runPitSentimentIngestion({ asset: parsed.data.asset })
        : await runPitIngestion(parsed.data);
    logger.set({
      audit: "pit_ingestion",
      datasetHash: result.datasetHash,
      job: "pit-ingestion",
      kind: result.kind,
      reused: result.reused,
    });
    return Response.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "PIT ingestion failed";
    logger.set({ job: "pit-ingestion", warning: message });
    return Response.json({ error: message }, { status: 502 });
  }
});
