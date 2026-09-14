import {
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * One row per (reader, event) the reader has marked as read.
 *
 * Readers are derived API-key identities — the sha256 of the terminal's API
 * key, never the key itself — so read state syncs across every device that
 * signs in with the same key. Event ids are the runtime feed's stable
 * per-event keys (see toId() in the events route); the feed is a ring
 * buffer, so rows past any useful window are pruned on write by the API.
 */
export const notificationReads = pgTable(
  "notification_reads",
  {
    eventId: text("event_id").notNull(),
    id: uuid("id").primaryKey().defaultRandom(),
    readAt: timestamp("read_at").notNull().defaultNow(),
    readerId: text("reader_id").notNull(),
  },
  (t) => ({
    readerEventIdx: unique().on(t.readerId, t.eventId),
    readerTimeIdx: index("notification_reads_reader_time_idx").on(
      t.readerId,
      t.readAt,
    ),
  }),
);
