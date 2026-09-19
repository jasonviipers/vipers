/**
 * One-shot verification for the Composio integration (safe: read-only).
 *
 * Run: bun scripts/verify-composio.ts [asset]
 *
 * Exercises the SAME code path as the app (src/lib/composio.ts):
 *  1. getChannelStatuses() — session.toolkits() with logos + connection state
 *  2. If Reddit is connected: one REDDIT_SEARCH_ACROSS_SUBREDDITS execution
 *     under the operator's connection, printing the Composio logId — the
 *     non-empty logId is the verification stamp (cross-checkable in
 *     dashboard.composio.dev → Platform → Logs).
 *
 * Nothing is mutated: no auth configs are created, no connection is initiated,
 * and no messages are written to the scraper store (that only happens inside
 * the app's request path).
 */

import { Composio } from "@composio/core";
import {
  COMPOSIO_OPERATOR_USER_ID,
  type ComposioRedditPost,
  fetchRedditPostsViaComposio,
  isComposioConfigured,
} from "../src/lib/composio";

const asset = process.argv[2] ?? "BTC";

if (!isComposioConfigured()) {
  console.error("FAIL: COMPOSIO_API_KEY is not set in the environment.");
  process.exit(1);
}
console.log("ok: COMPOSIO_API_KEY present");

const client = new Composio();

// ── Step 1: channel status through the app's own function ──────────────────
const { getChannelStatuses } = await import("../src/lib/composio");
const status = await getChannelStatuses();
console.log(`ok: configured=${status.configured}`);
for (const channel of status.channels) {
  console.log(
    `  ${channel.slug.padEnd(9)} connected=${channel.connected} logo=${
      channel.logo ? "yes" : "none"
    } name=${channel.name}`,
  );
}

const reddit = status.channels.find((c) => c.slug === "reddit");
if (!reddit?.connected) {
  console.error(
    "\nINCOMPLETE: Reddit is not connected for the operator yet. " +
      "Open /channels in the app and click CONNECT next to Reddit, then re-run " +
      "this script. (Connection state is per Composio user: " +
      `${COMPOSIO_OPERATOR_USER_ID}.)`,
  );
  process.exit(2);
}
console.log("ok: reddit connection active for the operator");

// ── Step 2: one read-only search through the app's own fetch function ──────
try {
  const posts: ComposioRedditPost[] = await fetchRedditPostsViaComposio({
    query: asset.toLowerCase(),
    subreddits: ["CryptoCurrency", "Bitcoin", "wallstreetbets"],
    limitPerSub: 5,
  });
  console.log(
    `ok: REDDIT_SEARCH_ACROSS_SUBREDDITS returned ${posts.length} posts`,
  );
  for (const post of posts.slice(0, 3)) {
    console.log(
      `  r/${post.subreddit ?? "?"} score=${post.score} ${post.title.slice(0, 80)}`,
    );
  }
} catch (error) {
  console.error(
    "FAIL: tool execution threw:",
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
}

// ── Step 3: capture the Composio logId via a direct session execute ────────
// The app's function discards logId, so run the same read-only call once more
// through session.execute() to surface it. Same tool, same read-only shape.
const session = await client.sessions.create(COMPOSIO_OPERATOR_USER_ID, {
  toolkits: ["reddit"],
});
const result = await session.execute("REDDIT_SEARCH_ACROSS_SUBREDDITS", {
  limit: 5,
  result_type: ["link"],
  search_query: `${asset.toLowerCase()} subreddit:CryptoCurrency`,
  sort: "new",
  time_filter: "day",
});

if (result.error) {
  console.error(`FAIL: tool reported an error: ${result.error}`);
  process.exit(1);
}
console.log(`ok: successful=true  logId=${result.logId}`);
console.log(
  "\nVERIFIED: Reddit read works end-to-end through the operator connection.",
);
console.log(
  `Cross-check the logId in dashboard.composio.dev → Platform → Logs.`,
);
