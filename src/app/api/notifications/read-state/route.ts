import { and, eq, lt, sql } from "drizzle-orm";

import { db } from "@/db";
import { notificationReads } from "@/db/schema/notifications";
import { useLogger, withEvlog } from "@/lib/evlog";
import { requestReaderId } from "@/lib/notification-reader";

export const dynamic = "force-dynamic";

/** Cap on stored read markers per reader (trimmed to newest on write). */
const MAX_ROWS_PER_READER = 500;

/**
 * GET /api/notifications/read-state — the caller's read event ids.
 *
 * Identity is the caller's session (signed cookie) or a hash of their API
 * key — the raw key/cookie is never stored. Unauthenticated callers get an
 * empty state so the bell degrades to local-only reads instead of failing.
 */
export const GET = withEvlog(async (request: Request) => {
  const logger = useLogger();
  logger.set({ integration: "notifications" });

  const readerId = requestReaderId(request);
  if (!readerId) {
    logger.set({ auth: { identified: false } });
    return Response.json({ eventIds: [], synced: false });
  }

  const rows = await db
    .select({ eventId: notificationReads.eventId })
    .from(notificationReads)
    .where(eq(notificationReads.readerId, readerId));

  logger.set({
    auth: { identified: true },
    reads: rows.length,
  });
  return Response.json({
    eventIds: rows.map((row) => row.eventId),
    synced: true,
  });
});

/**
 * PUT /api/notifications/read-state — mark events as read for the caller.
 *
 * Body: { eventIds: string[] } (bounded). Idempotent upserts on the
 * (reader, event) pair; after each write the reader's history is trimmed
 * to the newest MAX_ROWS_PER_READER rows, so the table stays bounded even
 * though the events feed is a rotating ring buffer.
 */
export const PUT = withEvlog(async (request: Request) => {
  const logger = useLogger();
  logger.set({ integration: "notifications" });

  const readerId = requestReaderId(request);
  if (!readerId) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  let eventIds: string[] = [];
  try {
    const body = (await request.json()) as { eventIds?: unknown };
    if (Array.isArray(body?.eventIds)) {
      eventIds = body.eventIds
        .filter((v): v is string => typeof v === "string")
        .map((id) => id.slice(0, 200))
        .slice(0, 100);
    }
  } catch {
    // fall through to the empty-array guard below
  }

  if (eventIds.length === 0) {
    return Response.json({ error: "eventIds required" }, { status: 400 });
  }

  await db
    .insert(notificationReads)
    .values(
      eventIds.map((eventId) => ({
        eventId,
        readerId,
      })),
    )
    .onConflictDoNothing();

  // Bound per-reader storage: keep only the newest MAX rows for this reader.
  const [count] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(notificationReads)
    .where(eq(notificationReads.readerId, readerId));

  if (count && count.total > MAX_ROWS_PER_READER) {
    const [cutoff] = await db
      .select({ readAt: notificationReads.readAt })
      .from(notificationReads)
      .where(eq(notificationReads.readerId, readerId))
      .orderBy(sql`read_at desc`)
      .limit(1)
      .offset(MAX_ROWS_PER_READER - 1);
    if (cutoff) {
      await db
        .delete(notificationReads)
        .where(
          and(
            eq(notificationReads.readerId, readerId),
            lt(notificationReads.readAt, cutoff.readAt),
          ),
        );
    }
  }

  logger.set({ reads: eventIds.length });
  return Response.json({ ok: true, marked: eventIds.length });
});
