import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { type OrderResult, placeOrder } from "./execution-tool";
import { fetchMarketQuote } from "./market-quote-tool";
import { fetchMarketSignals } from "./market-signals-tool";
import { evaluateProposalRisk } from "./risk-tool";
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
  execute: async ({ asset, confidence }) =>
    evaluateProposalRisk(
      { asset, confidence },
      {
        maxDailyLossPct: 3,
        maxPositionPct: 5,
      },
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
