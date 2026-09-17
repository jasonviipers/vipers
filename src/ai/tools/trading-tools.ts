import { tool } from "ai";
import { z } from "zod";

import { fetchMarketQuote } from "./market-quote-tool";
import { fetchNewsSignals, fetchRedditSignals } from "./market-signals-tool";
import { fetchStockTwitsSentiment } from "./stocktwits-tool";
import { fetchTwitterSentiment } from "./twitter-tool";

export const scrapeRedditTool = tool({
  description:
    "Scrape Reddit for an asset: recent posts mentioning the symbol, scored with VADER (0..1, 0.5 neutral).",
  inputSchema: z.object({ asset: z.string() }),
  execute: ({ asset }) => fetchRedditSignals(asset),
});

export const scrapeNewsTool = tool({
  description:
    "Scrape news/RSS headline feeds for an asset: matching recent headlines, scored with VADER (0..1, 0.5 neutral).",
  inputSchema: z.object({ asset: z.string() }),
  execute: ({ asset }) => fetchNewsSignals(asset),
});

export const scrapeTwitterTool = tool({
  description:
    "Scrape Twitter/X for an asset: recent organic tweets mentioning the symbol, scored with VADER (0..1, 0.5 neutral). Requires TWITTER_BEARER_TOKEN; returns unconfigured:true otherwise.",
  inputSchema: z.object({ asset: z.string() }),
  execute: ({ asset }) => fetchTwitterSentiment(asset),
});

export const gatherStockTwitsSentimentTool = tool({
  description: "Read StockTwits crowd sentiment for an asset.",
  inputSchema: z.object({ asset: z.string() }),
  execute: ({ asset }) => fetchStockTwitsSentiment(asset),
});

export const fetchMarketQuoteTool = tool({
  description: "Fetch a live market quote for a crypto or equity symbol.",
  inputSchema: z.object({ asset: z.string() }),
  execute: ({ asset }) => fetchMarketQuote(asset),
});
