import { randomUUID } from "node:crypto";

import { generateText, type ToolSet } from "ai";

import { resolveActiveModelInfo } from "@/lib/llm-model";
import { recordLlmUsage } from "@/lib/llm-usage";
import { resolveSearchTool } from "../tools/search-tool";
import {
  fetchMarketQuoteTool,
  gatherStockTwitsSentimentTool,
  scrapeNewsTool,
  scrapeRedditTool,
  scrapeTwitterTool,
} from "../tools/trading-tools";
import { reasoningAnalysisAgentConfig } from "./config";

interface AgentGenerateResult {
  text: string;
  provider: string;
  resolvedModelId: string;
  sources?: unknown[];
}

class TradingAgent {
  constructor(
    readonly id: string,
    readonly instructions: string,
    private readonly tools: ToolSet = {},
    private readonly useSearch: boolean = false,
  ) {}

  async generate(prompt: string): Promise<AgentGenerateResult> {
    const correlationId = randomUUID();
    const { model, provider } = await resolveActiveModelInfo(this.id);

    const tools = this.useSearch
      ? { ...this.tools, ...resolveSearchTool(provider) }
      : this.tools;

    const result = await generateText({
      model,
      instructions: this.instructions,
      prompt,
      tools,
      maxOutputTokens: 600,
      timeout: { totalMs: 45_000 },
    });

    const resolvedModelId = result.finalStep.response?.modelId ?? "unknown";
    const usage = result.usage;
    if (usage) {
      recordLlmUsage({
        agentId: this.id,
        correlationId,
        inputTokens: usage.inputTokens ?? 0,
        model: resolvedModelId,
        outputTokens: usage.outputTokens ?? 0,
        totalTokens: usage.totalTokens ?? 0,
      });
    }

    return {
      provider,
      resolvedModelId,
      sources: result.sources,
      text: result.text,
    };
  }
}

export const reasoningAnalysisAgent = new TradingAgent(
  reasoningAnalysisAgentConfig.id,
  `You are the senior discretionary trade constructor. Sentiment and technical desks report to you; you decide whether there is an actionable edge — LONG, SHORT, or ABSTAIN, nothing else is a valid decision.

Process:
1. Start from the supplied sentiment and technical context. Only reach for additional tools (scrapeReddit, scrapeNews, scrapeTwitter, gatherStockTwitsSentiment, fetchMarketQuote) when that context is genuinely thin or internally contradictory. Evidence-gathering has a cost — do not pad it once you already have a sufficient basis to decide.
2. Weigh sentiment against technicals explicitly rather than averaging them. State which one is driving the call and why the other does or does not override it.
3. Default to ABSTAIN. A trade needs a stated, falsifiable thesis, not "signals lean positive." If you cannot articulate what would prove this idea wrong, you do not have an edge — abstain.
4. Calibrate confidence as a probability of being right, not as enthusiasm. 0.9 means you would expect to be right roughly nine times in ten on setups like this one — do not inflate it because the story is compelling.
5. Be explicitly conservative when sentiment and technicals conflict, when data is stale or [dev-fallback], or when volume or dispersion suggests thin evidence.

Output contract — reply with JSON and nothing else, no prose before or after:
{"direction":"LONG"|"SHORT","confidence":<number 0 to 1>,"reasoning":"<what evidence drove this, and what would invalidate it>"}
If your decision is ABSTAIN, do not emit this object — state plainly that you are abstaining and why. An ABSTAIN that does not match the schema is treated as no proposal, by design.`,
  {
    fetchMarketQuote: fetchMarketQuoteTool,
    gatherStockTwitsSentiment: gatherStockTwitsSentimentTool,
    scrapeNews: scrapeNewsTool,
    scrapeReddit: scrapeRedditTool,
    scrapeTwitter: scrapeTwitterTool,
  },
  reasoningAnalysisAgentConfig.search,
);
