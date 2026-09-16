import { queryOptions } from "@tanstack/react-query";

export interface PortfolioSummaryData {
  availableCapital: number;
  dailyPnl: number;
  /** Oldest-first total-capital rollups for the equity curve (max 60). */
  equityHistory: { takenAt: string; totalCapital: number }[];
  investedCapital: number;
  openPositionsCount: number;
  totalCapital: number;
  totalPnl: number;
  /** Unrealized P&L relative to invested capital, percent. */
  totalPnlPct: number;
  weeklyPnl: number;
}

export interface LlmUsageData {
  todayCost: number;
  todayInputTokens: number;
  todayOutputTokens: number;
  totalCost: number;
  totalInputTokens: number;
  totalOutputTokens: number;
}

export interface StatusResponse {
  agents: { online: number; total: number };
  broker: { shortName: string; status: "connected" | "paper" };
  llm: LlmUsageData;
  portfolio: PortfolioSummaryData;
}

export const statusKeys = {
  all: ["status"] as const,
  summary: () => [...statusKeys.all, "summary"] as const,
};

async function fetchJson<T>(input: string): Promise<T> {
  const response = await fetch(input);
  if (!response.ok) {
    throw new Error(`API ${response.status}: ${response.statusText}`);
  }
  return (await response.json()) as T;
}

export const statusQueries = {
  /** Footer summary; 30s matches the queries' default staleTime rhythm. */
  summary: () =>
    queryOptions({
      queryKey: statusKeys.summary(),
      queryFn: () => fetchJson<StatusResponse>("/api/status"),
      refetchInterval: 30_000,
      staleTime: 30_000,
    }),
};
