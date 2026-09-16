import { tool } from "ai";
import { z } from "zod";

import { fetchMarketQuote } from "./market-quote-tool";
import {
  fetchMarketSignals,
  fetchNewsSignals,
  fetchRedditSignals,
} from "./market-signals-tool";
import { evaluateProposalRiskServer } from "./risk-tool";
import {
  fetchStockTwitsSentiment,
  fetchStockTwitsTrending,
} from "./stocktwits-tool";
import { fetchTechnicals } from "./technical-analysis-tool";
import { fetchTwitterSentiment } from "./twitter-tool";

export const gatherMarketSignalsTool = tool({
  description: "Gather market sentiment signals for an asset.",
  inputSchema: z.object({ asset: z.string() }),
  execute: ({ asset }) => fetchMarketSignals(asset),
});

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

export const gatherStockTwitsTrendingSymbolsTool = tool({
  description: "List currently trending StockTwits symbols.",
  inputSchema: z.object({}),
  execute: () => fetchStockTwitsTrending(),
});

export const analyzeStockTwitsSentimentTool = gatherStockTwitsSentimentTool;
export const analyzeStockTwitsTrendingTool =
  gatherStockTwitsTrendingSymbolsTool;

export const analyzeTechnicalsTool = tool({
  description: "Fetch technical indicators and regime for an asset.",
  inputSchema: z.object({ asset: z.string() }),
  execute: ({ asset }) => fetchTechnicals(asset),
});

export const evaluateRiskTool = tool({
  description: "Evaluate a proposal against the server-owned risk gate.",
  inputSchema: z.object({
    asset: z.string(),
    confidence: z.number().min(0).max(1),
  }),
  execute: ({ asset, confidence }) =>
    evaluateProposalRiskServer(
      { asset, confidence },
      { maxDailyLossPct: 3, maxPositionPct: 5 },
    ),
});

export const fetchMarketQuoteTool = tool({
  description: "Fetch a live market quote for a crypto or equity symbol.",
  inputSchema: z.object({ asset: z.string() }),
  execute: ({ asset }) => fetchMarketQuote(asset),
});
