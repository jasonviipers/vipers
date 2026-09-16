import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/scraper-schema/*",
  out: "./src/db/scraper-migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.SCRAPER_DATABASE_URL as string,
  },
  strict: true,
  verbose: true,
});
