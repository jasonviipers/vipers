/**
 * Agent configuration is deliberately separate from runtime status.
 *
 * Config describes WHAT an agent is (identity, model, tools, limits) and can
 * be changed without touching live performance data. Runtime status (health,
 * heartbeats, metrics, live state) is recorded separately while the system
 * runs, so swapping a model or a prompt never mutates performance history.
 */

export type AgentTeam =
  | "SENTIMENT"
  | "ANALYSIS"
  | "RISK"
  | "EXECUTION"
  | "COORDINATION";

export interface AgentConfig {
  id: string;
  codename?: string;
  maxConcurrency: number;
  model: string;
  riskLimits?: {
    maxPositionPct: number;
    maxDailyLoss: number;
  };
  role: string;
  team: AgentTeam;
  timeoutMs: number;
  tools: string[];
}

export type AgentHealth = "HEALTHY" | "DEGRADED" | "OFFLINE";

export interface AgentRuntimeStatus {
  health: AgentHealth;
  id: string;
  lastHeartbeatAt: string | null;
  metrics: {
    eventsHandled: number;
    errors: number;
    avgHandleTimeMs: number | null;
  };
}

export function createEmptyRuntimeStatus(id: string): AgentRuntimeStatus {
  return {
    health: "HEALTHY",
    id,
    lastHeartbeatAt: null,
    metrics: {
      avgHandleTimeMs: null,
      errors: 0,
      eventsHandled: 0,
    },
  };
}

export const sentimentAgentConfig: AgentConfig = {
  id: "sentiment-agent",
  codename: "PULSE_READER",
  maxConcurrency: 2,
  model: "google/gemini-3.8-flash",
  role: "Extract market sentiment from social and news sources",
  team: "SENTIMENT",
  timeoutMs: 30_000,
  tools: ["gatherMarketSignals"],
};

export const technicalAnalysisAgentConfig: AgentConfig = {
  id: "technical-analysis-agent",
  codename: "CHART_SCOUT",
  maxConcurrency: 2,
  model: "google/gemini-3.8-flash",
  role: "Technical indicators, regime detection and pattern analysis",
  team: "ANALYSIS",
  timeoutMs: 30_000,
  tools: ["analyzeTechnicals"],
};

export const reasoningAnalysisAgentConfig: AgentConfig = {
  id: "reasoning-analysis-agent",
  codename: "THESIS_FORGE",
  maxConcurrency: 1,
  model: "google/gemini-3.8-flash",
  role: "LLM reasoning over signals to produce trade proposals",
  team: "ANALYSIS",
  timeoutMs: 45_000,
  tools: ["fetchMarketQuote"],
};

export const riskAgentConfig: AgentConfig = {
  id: "risk-agent",
  codename: "VAULT_SHIELD",
  maxConcurrency: 1,
  model: "google/gemini-3.8-flash",
  riskLimits: {
    maxDailyLoss: 3,
    maxPositionPct: 5,
  },
  role: "Hard validation: sizing, exposure, drawdown, correlation",
  team: "RISK",
  timeoutMs: 20_000,
  tools: ["evaluateRisk", "fetchMarketQuote"],
};

export const executionAgentConfig: AgentConfig = {
  id: "order-executor-agent",
  codename: "STRIKE_VIPER",
  maxConcurrency: 1,
  model: "google/gemini-3.8-flash",
  role: "Broker orders, fills, retries, reconciliation and order lifecycle",
  team: "EXECUTION",
  timeoutMs: 20_000,
  tools: ["submitOrder"],
};

export const coordinatorAgentConfig: AgentConfig = {
  id: "orchestrator-agent",
  codename: "ALPHA_SENTINEL",
  maxConcurrency: 1,
  model: "google/gemini-3.8-flash",
  role: "Aggregate proposals, run consensus, schedule and resolve conflicts",
  team: "COORDINATION",
  timeoutMs: 30_000,
  tools: [],
};

export const agentConfigs: AgentConfig[] = [
  sentimentAgentConfig,
  technicalAnalysisAgentConfig,
  reasoningAnalysisAgentConfig,
  riskAgentConfig,
  executionAgentConfig,
  coordinatorAgentConfig,
];
