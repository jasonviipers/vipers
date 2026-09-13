import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is not set");
}

// Disable prefetch — the postgres.js driver docs recommend this with
// drizzle to avoid errors when the connection pool is closed mid-query.
const client = postgres(connectionString, { prepare: false, max: 10 });

export const db = drizzle(client, { schema });
