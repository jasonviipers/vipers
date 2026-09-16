import {
  DEFAULT_ASSETS,
  fetchMarketQuotes,
  quoteToTicker,
} from "@/ai/tools/market-quote-tool";
import { useLogger, withEvlog } from "@/lib/evlog";

export const dynamic = "force-dynamic";

/**
 * GET /api/quotes — live ticker rows for the TickerBar.
 * Cached server-side by market-quote-tool (20s TTL); failures for a single
 * asset degrade gracefully because the tool falls back to stale cache.
 */
export const GET = withEvlog(async () => {
  const logger = useLogger();
  logger.set({ integration: "market-data" });

  try {
    const quotes = await fetchMarketQuotes(DEFAULT_ASSETS);
    return Response.json({ items: quotes.map(quoteToTicker) });
  } catch (error) {
    // All assets failed (e.g. no network on server). Serve an empty set
    // rather than erroring: the bar renders its placeholder state.
    logger.set({ error: error instanceof Error ? error.message : "unknown" });
    return Response.json({ items: [] }, { status: 200 });
  }
});
