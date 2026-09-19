// Ad-hoc DB inspection script (module marker keeps tsc's global scope clean).
import { sql } from "bun";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL missing");
}

// events: real columns are `type` + `created_at`, not `category`/`timestamp`
const events = await sql`
  SELECT type, message, created_at
  FROM events
  ORDER BY created_at DESC
  LIMIT 15
`;
console.log("RECENT EVENTS:");
for (const e of events) {
  console.log(`  ${e.created_at} [${e.type}] ${e.message}`);
}

// type + amount live on capital_transactions, not ledger_transactions
const capitalTx = await sql`
  SELECT type, amount, created_at
  FROM capital_transactions
  ORDER BY created_at DESC
  LIMIT 5
`;
console.log("RECENT CAPITAL TX:");
for (const t of capitalTx) {
  console.log(`  ${t.created_at} ${t.type} ${t.amount}`);
}

// not in the schema I can see — guarded so a missing table doesn't kill the script
try {
  const health = await sql`
    SELECT broker_id, healthy, last_checked_at
    FROM broker_health
    ORDER BY last_checked_at DESC
    LIMIT 5
  `;
  console.log("BROKER HEALTH:", JSON.stringify(health));
} catch (err) {
  console.log("BROKER HEALTH: skipped —", (err as Error).message);
}

await sql.end();
