import { queryOptions } from "@tanstack/react-query";

export interface OpenPosition {
  id: string;
  asset: string;
  direction: "LONG" | "SHORT";
  /** Agent display name (from agents.name); falls back to the id. */
  agentName: string;
  entryPrice: number;
  /** Latest mark price from the market_prices cache; null = no tick yet. */
  currentPrice: number | null;
  quantity: number;
  pnl: number;
  pnlPct: number;
  openedAt: string;
}

export interface OpenPositionsResponse {
  items: OpenPosition[];
}

export interface ClosedPosition {
  id: string;
  asset: string;
  direction: "LONG" | "SHORT";
  /** Agent display name (from agents.name); falls back to the id. */
  agentName: string;
  entryPrice: number;
  /** Mark price recorded at close; null when the row predates price caching. */
  exitPrice: number | null;
  quantity: number;
  pnl: number;
  pnlPct: number;
  openedAt: string;
  closedAt: string;
}

export interface ClosedPositionsResponse {
  items: ClosedPosition[];
}

export const openPositionsKeys = {
  all: ["positions-open"] as const,
  list: () => [...openPositionsKeys.all, "list"] as const,
};

export const closedPositionsKeys = {
  all: ["positions-closed"] as const,
  list: () => [...closedPositionsKeys.all, "list"] as const,
};

async function fetchJson<T>(input: string): Promise<T> {
  const response = await fetch(input);
  if (!response.ok) {
    throw new Error(`API ${response.status}: ${response.statusText}`);
  }
  return (await response.json()) as T;
}

export const openPositionsQueries = {
  /** 30s poll: pnl/currentPrice are cached by the server-side price-tick job. */
  list: () =>
    queryOptions({
      queryKey: openPositionsKeys.list(),
      queryFn: () => fetchJson<OpenPositionsResponse>("/api/positions/open"),
      refetchInterval: 30_000,
      staleTime: 30_000,
    }),
};

export const closedPositionsQueries = {
  /** History is immutable per row; a 60s poll only catches brand-new closes. */
  list: () =>
    queryOptions({
      queryKey: closedPositionsKeys.list(),
      queryFn: () =>
        fetchJson<ClosedPositionsResponse>("/api/positions/closed"),
      refetchInterval: 60_000,
      staleTime: 60_000,
    }),
};
