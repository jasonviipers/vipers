import { Agent } from "@mastra/core/agent";
import { resolveActiveModel } from "@/lib/llm-model";
import {
  analyzeTechnicalsTool,
  evaluateRiskTool,
  fetchMarketQuoteTool,
  gatherMarketSignalsTool,
} from "../tools/trading-tools";
import {
  coordinatorAgentConfig,
  executionAgentConfig,
  reasoningAnalysisAgentConfig,
  riskAgentConfig,
  sentimentAgentConfig,
  technicalAnalysisAgentConfig,
} from "./config";

/**
 * One Mastra Agent per role. The `AgentConfig` entries in `config.ts` remain
 * the source of truth for identity/model/limits; these instances bind the
 * runtime behavior (instructions + tools) to those configs.
 */

export const sentimentAgent = new Agent({
  id: sentimentAgentConfig.id,
  instructions: `
    You are the SENTIMENT agent in a multi-agent trading system.

    Responsibility: extract sentiment signals from Reddit, Twitter, RSS, news,
    social volume and qualitative market chatter for a given asset.

    Gather market sentiment for the asset using the ${sentimentAgentConfig.tools[0]} capability, then
    summarize the sentiment picture concisely. Do not propose trades and do not
    size positions; your job ends at a faithful signal description.
  `,
  // Resolved per call from the operator's DEFAULT LLM PROVIDER setting.
  model: () => resolveActiveModel(),
  name: sentimentAgentConfig.codename ?? "Sentiment",
  tools: { gatherMarketSignalsTool },
});

export const technicalAnalysisAgent = new Agent({
  id: technicalAnalysisAgentConfig.id,
  instructions: `
    You are an ANALYSIS team agent in a multi-agent trading system.

    Responsibility: technical indicators, market regime detection and pattern
    analysis. Pull the technical indicator snapshot with the
    ${technicalAnalysisAgentConfig.tools[0]} capability, then interpret it.

    Report trend, regime and notable patterns. Do not submit orders.
  `,
  model: () => resolveActiveModel(),
  name: technicalAnalysisAgentConfig.codename ?? "Technical Analysis",
  tools: { analyzeTechnicalsTool },
});

export const reasoningAnalysisAgent = new Agent({
  id: reasoningAnalysisAgentConfig.id,
  instructions: `
    You are an ANALYSIS team agent in a multi-agent trading system.

    Responsibility: LLM reasoning. You receive a market signal plus technical
    context and must decide a direction: LONG, SHORT, or ABSTAIN if evidence is
    weak. Provide a confidence between 0 and 1 and a one-paragraph rationale.

    Be conservative: when signals conflict, lower confidence or abstain.
  `,
  model: () => resolveActiveModel(),
  name: reasoningAnalysisAgentConfig.codename ?? "Reasoning Analysis",
  tools: { fetchMarketQuoteTool },
});

export const riskAgent = new Agent({
  id: riskAgentConfig.id,
  instructions: `
    You are the RISK agent in a multi-agent trading system. You are the
    MANDATORY gate: nothing reaches execution without your approval.

    Responsibility: position sizing, exposure limits, drawdown checks,
    correlation and compliance. Apply the risk tool
    (${riskAgentConfig.tools[0]}) and respect the configured limits: max position
    ${riskAgentConfig.riskLimits?.maxPositionPct ?? 5}% of book and max daily
    loss ${riskAgentConfig.riskLimits?.maxDailyLoss ?? 3}%.

    Approval is binary and non-negotiable. If any limit is violated, reject
    with the specific reason.
  `,
  model: () => resolveActiveModel(),
  name: riskAgentConfig.codename ?? "Risk",
  tools: { evaluateRiskTool, fetchMarketQuoteTool },
});

export const executionAgent = new Agent({
  id: executionAgentConfig.id,
  instructions: `
    You are the EXECUTION agent in a multi-agent trading system. You are the
    ONLY component allowed to submit broker orders, and only for proposals that
    carry a RISK_APPROVED decision.

    Responsibility: broker orders, fills, retries, reconciliation and order
    lifecycle. Report submitted, filled or failed status with the order id.
  `,
  model: () => resolveActiveModel(),
  name: executionAgentConfig.codename ?? "Order Executor",
  // The workflow, not an LLM tool call, invokes execution after its
  // server-owned deterministic risk gate has approved a proposal.
  tools: {},
});

export const coordinatorAgent = new Agent({
  id: coordinatorAgentConfig.id,
  instructions: `
    You are the COORDINATION agent of a multi-agent trading system.

    Responsibility: aggregate analysis proposals, manage consensus voting,
    schedule work and resolve conflicts between agents. You never place orders
    and you never approve risk; you orchestrate the flow and decide when a
    consensus has formed or when a signal should be dropped.
  `,
  model: () => resolveActiveModel(),
  name: coordinatorAgentConfig.codename ?? "Orchestrator",
  tools: {},
});
