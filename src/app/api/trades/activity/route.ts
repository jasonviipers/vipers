import { sql } from "drizzle-orm";

import { db } from "@/db";
import { positions } from "@/db/schema/trading";
import { useLogger, withEvlog } from "@/lib/evlog";
import { agentRuntime } from "@/mastra/runtime/agent-runtime";

export const dynamic = "force-dynamic";

const WINDOW_HOURS = 24;
const BUCKET_COUNT = 24;

interface Bucket {
  time: string;
  value: number;
  /** Net direction: LONG minus SHORT for the bucket. */
  net: number;
}

/**
 * GET /api/trades/activity — hourly trade counts for the dashboard's
 * TradesChart (last 24h, 24 buckets, oldest-first).
 *
 * Primary source: `positions` (opened positions per hour). Empty table →
 * bucket the process-local ORDER_FILLED / ORDER_SUBMITTED events instead,
 * mirroring the signals route. Bars color by net direction (LONG green,
 * SHORT red).
 */
export const GET = withEvlog(async () => {
  const logger = useLogger();
  logger.set({ integration: "trades" });

  const bucketMs = (WINDOW_HOURS / BUCKET_COUNT) * 3_600_000; // 1h
  const windowStart = new Date(Date.now() - WINDOW_HOURS * 3_600_000);

  const buckets: Bucket[] = [];
  let source: "db" | "events" = "db";

  try {
    const rows = await db
      .select({
        bucket: sql<number>`floor(extract(epoch from (${positions.openedAt} - ${windowStart.toISOString()}::timestamptz)) / ${bucketMs})`,
        longs: sql<number>`count(*) filter (where ${positions.direction} = 'LONG')`,
        shorts: sql<number>`count(*) filter (where ${positions.direction} = 'SHORT')`,
        total: sql<number>`count(*)`,
      })
      .from(positions)
      .where(
        sql`${positions.openedAt} >= ${windowStart.toISOString()}::timestamptz`,
      )
      .groupBy(sql`1`)
      .orderBy(sql`1`);

    for (const row of rows) {
      const index = Number(row.bucket);
      if (index < 0 || index >= BUCKET_COUNT) {
        continue;
      }
      buckets[index] = {
        net: Number(row.longs) - Number(row.shorts),
        time: new Date(
          windowStart.getTime() + (index + 1) * bucketMs,
        ).toISOString(),
        value: Number(row.total),
      };
    }
  } catch (error) {
    logger.set({
      warning: `positions db unavailable: ${
        error instanceof Error ? error.message : "unknown"
      }`,
    });
  }

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
      if (event.type !== "ORDER_FILLED" && event.type !== "ORDER_SUBMITTED") {
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
        net: current.net + (event.direction === "LONG" ? 1 : -1),
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
