import { generateText, type ToolSet } from "ai";

import { resolveActiveModel } from "@/lib/llm-model";
import {
  analyzeTechnicalsTool,
  evaluateRiskTool,
  fetchMarketQuoteTool,
  gatherMarketSignalsTool,
  gatherStockTwitsSentimentTool,
  scrapeNewsTool,
  scrapeRedditTool,
  scrapeTwitterTool,
} from "../tools/trading-tools";
import {
  coordinatorAgentConfig,
  executionAgentConfig,
  reasoningAnalysisAgentConfig,
  riskAgentConfig,
  sentimentAgentConfig,
  technicalAnalysisAgentConfig,
} from "./config";

export interface AgentGenerateResult {
  text: string;
}

export class TradingAgent {
  constructor(
    readonly id: string,
    readonly instructions: string,
    private readonly tools: ToolSet = {},
  ) {}

  async generate(prompt: string): Promise<AgentGenerateResult> {
    const result = await generateText({
      model: await resolveActiveModel(),
      instructions: this.instructions,
      prompt,
      tools: this.tools,
      maxOutputTokens: 600,
      timeout: { totalMs: 45_000 },
    });
    return { text: result.text };
  }
}

export const sentimentAgent = new TradingAgent(
  sentimentAgentConfig.id,
  "You are the SENTIMENT agent. Extract market sentiment from social, news, and market signals. Scrape any and all available channels before judging: Reddit (scrapeReddit), news/RSS (scrapeNews), Twitter/X (scrapeTwitter), StockTwits (scrapeStockTwits), and optionally the combined gatherMarketSignals. Do not propose trades or size positions.",
  {
    gatherMarketSignals: gatherMarketSignalsTool,
    gatherStockTwitsSentiment: gatherStockTwitsSentimentTool,
    scrapeNews: scrapeNewsTool,
    scrapeReddit: scrapeRedditTool,
    scrapeTwitter: scrapeTwitterTool,
  },
);

export const technicalAnalysisAgent = new TradingAgent(
  technicalAnalysisAgentConfig.id,
  "You are the TECHNICAL ANALYSIS agent. Interpret indicators, market regime, and price patterns. Do not submit orders.",
  { analyzeTechnicals: analyzeTechnicalsTool },
);

export const reasoningAnalysisAgent = new TradingAgent(
  reasoningAnalysisAgentConfig.id,
  "You are the REASONING ANALYSIS agent. Decide LONG, SHORT, or ABSTAIN from the supplied evidence. Gather additional evidence when the supplied context is thin by scraping Reddit, news, Twitter/X, or StockTwits and by fetching the market quote. Return JSON with direction, confidence from 0 to 1, and reasoning. Be conservative when evidence conflicts.",
  {
    fetchMarketQuote: fetchMarketQuoteTool,
    gatherStockTwitsSentiment: gatherStockTwitsSentimentTool,
    scrapeNews: scrapeNewsTool,
    scrapeReddit: scrapeRedditTool,
    scrapeTwitter: scrapeTwitterTool,
  },
);

export const riskAgent = new TradingAgent(
  riskAgentConfig.id,
  "You are the RISK agent. Risk approval is mandatory before execution. Reject anything violating the configured risk limits, kill switch, loss cap, position cap, or market-data freshness rules.",
  { evaluateRisk: evaluateRiskTool, fetchMarketQuote: fetchMarketQuoteTool },
);

export const executionAgent = new TradingAgent(
  executionAgentConfig.id,
  "You are the EXECUTION agent. Only execute proposals already approved by the deterministic server-owned risk gate.",
);

export const coordinatorAgent = new TradingAgent(
  coordinatorAgentConfig.id,
  "You are the COORDINATION agent. Aggregate proposals and form advisory consensus. Never approve risk or submit orders.",
);
