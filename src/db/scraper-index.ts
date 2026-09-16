import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as scraperSchema from "./scraper-schema";

/**
 * Drizzle client for the durable scraper store (SCRAPER_DATABASE_URL).
 *
 * Kept separate from the financial `db` on purpose: this connection is the
 * only one allowed to touch scraped messages / scrape-cache rows, so a bug in
 * a scraper can never corrupt the trading schema. When the URL is unset the
 * scraper tools silently proceed with in-process caches only.
 */
let scraper: postgres.Sql | undefined;
let scraperDb: ReturnType<typeof drizzle<typeof scraperSchema>> | undefined;

const connectionString = process.env.SCRAPER_DATABASE_URL;

if (connectionString) {
  scraper = postgres(connectionString, { prepare: false, max: 5 });
  scraperDb = drizzle(scraper, { schema: scraperSchema });
}

export const isScraperStoreConfigured = (): boolean => scraperDb !== undefined;

export { scraperDb };
