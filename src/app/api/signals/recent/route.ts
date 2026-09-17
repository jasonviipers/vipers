import { desc } from "drizzle-orm";
import { agentRuntime } from "@/ai/runtime/agent-runtime";
import { db } from "@/db";
import { signals } from "@/db/schema/signals";
import { getLogger, withEvlog } from "@/lib/evlog";
import type {
  RecentSignal,
  RecentSignalsResponse,
} from "@/lib/queries/signals";

export const dynamic = "force-dynamic";

const LIMIT = 30;

/**
 * GET /api/signals/recent — newest signals for the dashboard's SignalFeed.
 *
 * Primary source: the `signals` table (newest-first). When it's empty (fresh
 * install) or unreachable, the process-local recent-event buffer
 * (SIGNAL_CREATED events from workflow / manual runs) is mapped into
 * pseudo-signals instead so the feed shows something real rather than an
 * empty panel — mirroring the signals activity route's fallback.
 */
export const GET = withEvlog(async () => {
  const logger = getLogger();
  logger.set({ integration: "signals" });

  let items: RecentSignal[] = [];
  let source: RecentSignalsResponse["source"] = "db";

  try {
    const rows = await db
      .select({
        asset: signals.asset,
        content: signals.content,
        createdAt: signals.createdAt,
        id: signals.id,
        score: signals.score,
        sentiment: signals.sentiment,
        source: signals.source,
        twitterConfirmed: signals.twitterConfirmed,
      })
      .from(signals)
      .orderBy(desc(signals.createdAt))
      .limit(LIMIT);

    items = rows.map((row) => ({
      asset: row.asset,
      content: row.content,
      createdAt: row.createdAt.toISOString(),
      id: row.id,
      score: row.score,
      sentiment: row.sentiment,
      source: row.source,
      twitterConfirmed: row.twitterConfirmed,
    }));
  } catch (error) {
    logger.set({
      warning: `signals db unavailable: ${
        error instanceof Error ? error.message : "unknown"
      }`,
    });
  }

  if (items.length === 0) {
    items = agentRuntime
      .listRecentEvents(100)
      .filter((event) => event.type === "SIGNAL_CREATED")
      .slice(0, LIMIT)
      .reverse()
      .map((event) => {
        if (event.type !== "SIGNAL_CREATED") {
          // Narrowed by the filter above; unreachable in practice.
          return null;
        }
        const pseudo: RecentSignal = {
          asset: event.asset,
          content: `sentiment signal via ${event.source} — confidence ${(event.confidence * 100).toFixed(0)}%`,
          createdAt: event.createdAt,
          // Runtime confidence is 0..1; the feed displays a 0-100 score.
          // High-confidence signals read as bullish, low as bearish, matching
          // the signals activity route's net-sentiment convention.
          score: Math.round(event.confidence * 100),
          sentiment:
            event.confidence >= 0.5
              ? ("bullish" as const)
              : ("bearish" as const),
          source: "reddit" as const,
          twitterConfirmed: false,
          id: event.signalId,
        };
        return pseudo;
      })
      .filter((s): s is RecentSignal => s !== null)
      .reverse();
    if (items.length > 0) {
      source = "events";
    }
  }

  return Response.json({ items, source } satisfies RecentSignalsResponse);
});
