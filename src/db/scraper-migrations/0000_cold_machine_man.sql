CREATE TABLE "scrape_cache" (
	"cache_key" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"fetched_at" timestamp DEFAULT now() NOT NULL,
	"payload" jsonb NOT NULL,
	"source" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scraped_messages" (
	"asset" text NOT NULL,
	"author" text,
	"body" text NOT NULL,
	"external_id" text NOT NULL,
	"fetched_at" timestamp DEFAULT now() NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"posted_at" timestamp,
	"raw" jsonb NOT NULL,
	"sentiment_label" text,
	"sentiment_score" double precision,
	"source" text NOT NULL,
	"url" text
);
--> statement-breakpoint
CREATE INDEX "scraped_messages_source_asset_posted_idx" ON "scraped_messages" USING btree ("source","asset","posted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "scraped_messages_source_external_idx" ON "scraped_messages" USING btree ("source","external_id");