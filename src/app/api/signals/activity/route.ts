import { sql } from "drizzle-orm";

import { db } from "@/db";
import { signals } from "@/db/schema/signals";
import { useLogger, withEvlog } from "@/lib/evlog";
import { agentRuntime } from "@/mastra/runtime/agent-runtime";

export const dynamic = "force-dynamic";

const WINDOW_HOURS = 24;
const BUCKET_COUNT = 24;

interface Bucket {
  /** Bucket start, ISO string. */
  time: string;
  /** Total signals in the bucket. */
  value: number;
  /** Bullish minus bearish (net sentiment direction for the bucket). */
  net: number;
}

/**
 * GET /api/signals/activity — hourly signal counts for the dashboard's
 * SignalChart (last 24h, 24 buckets, oldest-first).
 *
 * Primary source: the `signals` table. When it's empty (fresh install), the
 * process-local recent-event buffer (SIGNAL_CREATED events from workflow /
 * manual runs) is bucketed instead so the chart shows something real rather
 * than an empty grid. Buckets with no signals render as zero-height.
 */
export const GET = withEvlog(async () => {
  const logger = useLogger();
  logger.set({ integration: "signals" });

  const bucketMs = (WINDOW_HOURS / BUCKET_COUNT) * 3_600_000; // 1h
  const windowStart = new Date(Date.now() - WINDOW_HOURS * 3_600_000);

  const buckets: Bucket[] = [];
  let source: "db" | "events" = "db";

  try {
    const rows = await db
      .select({
        bucket: sql<number>`floor(extract(epoch from (${signals.createdAt} - ${windowStart.toISOString()}::timestamptz)) / ${bucketMs})`,
        bullish: sql<number>`count(*) filter (where ${signals.sentiment} = 'bullish')`,
        bearish: sql<number>`count(*) filter (where ${signals.sentiment} = 'bearish')`,
        total: sql<number>`count(*)`,
      })
      .from(signals)
      .where(
        sql`${signals.createdAt} >= ${windowStart.toISOString()}::timestamptz`,
      )
      .groupBy(sql`1`)
      .orderBy(sql`1`);

    for (const row of rows) {
      const index = Number(row.bucket);
      if (index < 0 || index >= BUCKET_COUNT) {
        continue;
      }
      buckets[index] = {
        net: Number(row.bullish) - Number(row.bearish),
        time: new Date(
          windowStart.getTime() + (index + 1) * bucketMs,
        ).toISOString(),
        value: Number(row.total),
      };
    }
  } catch (error) {
    logger.set({
      warning: `signals db unavailable: ${
        error instanceof Error ? error.message : "unknown"
      }`,
    });
  }

  // Fill gaps and detect emptiness.
  for (let i = 0; i < BUCKET_COUNT; i++) {
    if (!buckets[i]) {
      buckets[i] = {
        net: 0,
        time: new Date(
          windowStart.getTime() + (i + 1) * bucketMs,
        ).toISOString(),
        value: 0,
      };
    }
  }

  if (buckets.every((b) => b.value === 0)) {
    const eventBuckets = new Map<number, { net: number; value: number }>();
    for (const event of agentRuntime.listRecentEvents(200)) {
      if (event.type !== "SIGNAL_CREATED") {
        continue;
      }
      const createdAt = new Date(event.createdAt).getTime();
      if (createdAt < windowStart.getTime()) {
        continue;
      }
      const index = Math.min(
        BUCKET_COUNT - 1,
        Math.floor((createdAt - windowStart.getTime()) / bucketMs),
      );
      const current = eventBuckets.get(index) ?? { net: 0, value: 0 };
      eventBuckets.set(index, {
        net: current.net + (event.confidence >= 0.5 ? 1 : -1),
        value: current.value + 1,
      });
    }
    if (eventBuckets.size > 0) {
      source = "events";
      for (const [index, agg] of eventBuckets) {
        buckets[index] = {
          net: agg.net,
          time: new Date(
            windowStart.getTime() + (index + 1) * bucketMs,
          ).toISOString(),
          value: agg.value,
        };
      }
    }
  }

  return Response.json({ buckets, source, windowHours: WINDOW_HOURS });
});
