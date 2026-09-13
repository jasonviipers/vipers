import { queryOptions } from "@tanstack/react-query";

/**
 * Fleet payload shape served by GET /api/agents/db (agent identity from
 * `agentConfigs`, runtime status from the in-process agent runtime, and
 * optional DB-backed performance stats).
 */
export interface AgentFleetEntry {
  id: string;
  codename: string | null;
  maxConcurrency: number;
  model: string;
  role: string;
  team: "SENTIMENT" | "ANALYSIS" | "EXECUTION" | "RISK" | "COORDINATION";
  timeoutMs: number;
  tools: string[];
  status: "online" | "offline" | "busy" | "error";
  runtime: {
    health: "HEALTHY" | "DEGRADED" | "OFFLINE";
    lastHeartbeatAt: string | null;
    metrics: {
      avgHandleTimeMs: number | null;
      errors: number;
      eventsHandled: number;
    };
  };
  stats: {
    equityData: number[];
    maxDrawdown: number;
    pnl: number;
    roi: number;
    sharpe: number;
    trades: number;
    winRate: number;
  };
}

export interface AgentsFleetResponse {
  items: AgentFleetEntry[];
  onlineCount: number;
  total: number;
}

export interface PendingProposal {
  id: string;
  asset: string;
  direction: "LONG" | "SHORT";
  quantity: number;
  entryPrice: number | null;
  reasoning: string;
  confidence: number;
  agentName: string;
}

export const agentsDbKeys = {
  all: ["agents-db"] as const,
  fleet: () => [...agentsDbKeys.all, "fleet"] as const,
};

async function fetchJson<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`API ${response.status}: ${detail || response.statusText}`);
  }
  return (await response.json()) as T;
}

export const agentsDbQueries = {
  fleet: () =>
    queryOptions({
      queryKey: agentsDbKeys.fleet(),
      queryFn: () => fetchJson<AgentsFleetResponse>("/api/agents/db"),
      // Heartbeats/metrics move on every pipeline run; poll keeps the
      // sidebar "online" indicators honest.
      refetchInterval: 15_000,
      staleTime: 15_000,
    }),
};
