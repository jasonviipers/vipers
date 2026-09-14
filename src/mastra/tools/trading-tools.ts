import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { type OrderResult, placeOrder } from "./execution-tool";
import { fetchMarketQuote } from "./market-quote-tool";
import { fetchMarketSignals } from "./market-signals-tool";
import { evaluateProposalRiskServer } from "./risk-tool";
import {
  fetchStockTwitsSentiment,
  fetchStockTwitsTrending,
} from "./stocktwits-tool";
import { fetchTechnicals } from "./technical-analysis-tool";

/**
 * Mastra tool wrappers around the trading-team functions.
 *
 * The plain functions in this directory are the deterministic execution core
 * (usable directly inside workflow steps); these `createTool` wrappers expose
 * the same capabilities to agents so the LLM can call them during `generate`.
 * Each wrapper mirrors the id declared in `agents/config.ts`.
 */

export const gatherMarketSignalsTool = createTool({
  description:
    "Gather market sentiment signals (social volume, sentiment score, highlights) for an asset",
  execute: async ({ asset }) => fetchMarketSignals(asset),
  id: "gatherMarketSignals",
  inputSchema: z.object({
    asset: z.string().describe("Asset symbol, e.g. BTC-USD"),
  }),
  outputSchema: z.object({
    asset: z.string(),
    breakdown: z.object({ redditScore: z.number(), rssScore: z.number() }),
    fetchedAt: z.number(),
    highlights: z.array(z.string()),
    sentimentScore: z.number(),
    socialVolume: z.number(),
    sources: z.object({ reddit: z.number(), rss: z.number() }),
    stale: z.boolean().optional(),
  }),
});

export const gatherStockTwitsSentimentTool = createTool({
  description:
    "Join the StockTwits crowd stream for an asset (what bulls/bears are saying). Returns Bullish/Bearish message counts, crowd reading and top messages/highlights",
  execute: async ({ asset }) => fetchStockTwitsSentiment(asset),
  id: "gatherStockTwitsSentiment",
  inputSchema: z.object({
    asset: z.string().describe("Asset symbol, e.g. BTC-USD, AAPL, TSLA"),
  }),
  outputSchema: z.object({
    asset: z.string(),
    crowd: z.enum(["BULLISH", "BEARISH", "MIXED"]),
    counts: z.object({
      bearish: z.number(),
      bullish: z.number(),
      unlabeled: z.number(),
    }),
    fetchedAt: z.number(),
    highlights: z.array(z.string()),
    sentimentScore: z.number(),
    socialVolume: z.number(),
    source: z.literal("stocktwits"),
    symbolId: z.number(),
    title: z.string(),
  }),
});

export const gatherStockTwitsTrendingSymbolsTool = createTool({
  description:
    "List symbols currently trending across the StockTwits crowd (crowd is rotating toward these names)",
  execute: async () => fetchStockTwitsTrending(),
  id: "gatherStockTwitsTrendingSymbols",
  inputSchema: z.object({}),
  outputSchema: z.object({
    fetchedAt: z.number(),
    items: z.array(
      z.object({
        id: z.number(),
        symbol: z.string(),
        title: z.string(),
      }),
    ),
    source: z.literal("stocktwits"),
  }),
});

/**
 * StockTwits crowd wrappers. The fetch core lives in `./stocktwits-tool.ts`
 * (cache + stale fallback + token-aware signed reads); these `createTool`
 * wrappers expose the same capability to the SENTIMENT agent so the LLM can
 * call them during `generate`. The ids match `agents/config.ts`.
 */

export const analyzeStockTwitsSentimentTool = createTool({
  description:
    "Analyze real-time StockTwits crowd sentiment for an asset (bullish/bearish/unlabeled counts, crowd call, sentiment score, highlights, top messages)",
  execute: async ({ asset }) => fetchStockTwitsSentiment(asset),
  id: "analyzeStockTwitsSentiment",
  inputSchema: z.object({
    asset: z.string().describe("Asset symbol, e.g. BTC-USD, AAPL"),
  }),
  outputSchema: z.object({
    asset: z.string(),
    counts: z.object({
      bearish: z.number().optional(),
      bullish: z.number().optional(),
      unlabeled: z.number().optional(),
    }),
    crowd: z.enum(["BEARISH", "BULLISH", "MIXED"]),
    fetchedAt: z.number(),
    highlights: z.array(z.string()),
    messages: z.array(
      z.object({
        body: z.string(),
        createdAt: z.string(),
        followers: z.number(),
        id: z.number(),
        likes: z.number(),
        sentiment: z.enum(["Bearish", "Bullish"]).nullable(),
        url: z.string(),
        username: z.string(),
      }),
    ),
    sentimentScore: z.number(),
    socialVolume: z.number(),
    source: z.literal("stocktwits"),
    symbolId: z.number(),
    title: z.string(),
    totalFollowers: z.number(),
    stale: z.boolean().optional(),
  }),
});

export const analyzeStockTwitsTrendingTool = createTool({
  description:
    "List symbols currently trending across the StockTwits crowd (early rotation candidates)",
  execute: async () => fetchStockTwitsTrending(),
  id: "analyzeStockTwitsTrending",
  inputSchema: z.object({}),
  outputSchema: z.object({
    fetchedAt: z.number(),
    items: z.array(
      z.object({
        id: z.number(),
        symbol: z.string(),
        title: z.string(),
      }),
    ),
    source: z.literal("stocktwits"),
  }),
});

/**
 * Technical wrappers.
 */
export const analyzeTechnicalsTool = createTool({
  description:
    "Fetch the technical indicator snapshot for an asset (trend, RSI, regime, patterns)",
  execute: async ({ asset }) => fetchTechnicals(asset),
  id: "analyzeTechnicals",
  inputSchema: z.object({
    asset: z.string().describe("Asset symbol, e.g. BTC-USD"),
  }),
  outputSchema: z.object({
    patterns: z.array(z.string()),
    regime: z.enum(["TRENDING", "RANGE_BOUND", "VOLATILE"]),
    rsi: z.number(),
    trend: z.enum(["UP", "DOWN", "SIDEWAYS"]),
  }),
});

export const evaluateRiskTool = createTool({
  description:
    "Evaluate a trade proposal against the configured risk limits. Returns approval, sized position (pct of book) and reason",
  // Server gate: includes the kill switch + daily-loss ledger checks and
  // fails closed on lookup errors. Limits mirror riskAgentConfig defaults.
  execute: async ({ asset, confidence }) =>
    evaluateProposalRiskServer(
      { asset, confidence },
      { maxDailyLossPct: 3, maxPositionPct: 5 },
    ),
  id: "evaluateRisk",
  inputSchema: z.object({
    asset: z.string().describe("Asset symbol, e.g. BTC-USD"),
    confidence: z
      .number()
      .min(0)
      .max(1)
      .describe("Proposal confidence between 0 and 1"),
  }),
  outputSchema: z.object({
    approved: z.boolean(),
    positionSizePct: z.number(),
    reason: z.string(),
  }),
});

export const submitOrderTool = createTool({
  description:
    "Submit a broker order for a risk-approved proposal. Returns order id, quantity and fill status",
  execute: async ({ asset, direction, positionSizePct, proposalId }) =>
    placeOrder({ asset, direction, positionSizePct, proposalId }).catch(
      (error): OrderResult => ({
        detail: `Broker order failed: ${(error as Error).message}`,
        orderId: `${proposalId}:o0`,
        quantity: 0,
        status: "FAILED",
      }),
    ),
  id: "submitOrder",
  inputSchema: z.object({
    asset: z.string().describe("Asset symbol, e.g. BTC-USD"),
    direction: z.enum(["LONG", "SHORT"]),
    positionSizePct: z
      .number()
      .gt(0)
      .max(100)
      .describe("Position size as percent of book"),
    proposalId: z.string().describe("Id of the risk-approved proposal"),
  }),
  outputSchema: z.object({
    detail: z.string().optional(),
    orderId: z.string(),
    quantity: z.number(),
    status: z.enum(["FILLED", "FAILED"]),
  }),
});

export const fetchMarketQuoteTool = createTool({
  description:
    "Fetch a live market quote (price, change, % change, volume) for a crypto or equity symbol. Crypto majors (BTC, ETH, SOL, XRP, DOGE) route through CoinGecko; any other symbol is treated as an equity ticker and sourced from Yahoo Finance.",
  execute: async ({ asset }) => fetchMarketQuote(asset),
  id: "fetchMarketQuote",
  inputSchema: z.object({
    asset: z.string().describe("Asset symbol, e.g. BTC-USD, AAPL, TSLA"),
  }),
  outputSchema: z.object({
    asset: z.string(),
    change: z.number(),
    changePct: z.number(),
    price: z.number(),
    source: z.enum(["coingecko", "yahoo"]),
    volume: z.string(),
  }),
});
