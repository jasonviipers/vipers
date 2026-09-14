CREATE TABLE "notification_reads" (
	"event_id" text NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"read_at" timestamp DEFAULT now() NOT NULL,
	"reader_id" text NOT NULL,
	CONSTRAINT "notification_reads_reader_id_event_id_unique" UNIQUE("reader_id","event_id")
);
--> statement-breakpoint
CREATE INDEX "notification_reads_reader_time_idx" ON "notification_reads" USING btree ("reader_id","read_at");