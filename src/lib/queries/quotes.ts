import { queryOptions } from "@tanstack/react-query";

export interface TickerItem {
  asset: string;
  change: number;
  changePct: number;
  price: number;
  signalScore: number;
  volume: string;
}

interface QuotesResponse {
  items: TickerItem[];
}

const quotesKeys = {
  all: ["quotes"] as const,
  live: () => [...quotesKeys.all, "live"] as const,
};

async function fetchJson<T>(input: string): Promise<T> {
  const response = await fetch(input);
  if (!response.ok) {
    throw new Error(`API ${response.status}: ${response.statusText}`);
  }
  return (await response.json()) as T;
}

export const quotesQueries = {
  /** Live ticker data for the TickerBar; polls every 30s to match the server cache TTL. */
  live: () =>
    queryOptions({
      queryKey: quotesKeys.live(),
      queryFn: () => fetchJson<QuotesResponse>("/api/quotes"),
      refetchInterval: 30_000,
      staleTime: 30_000,
      // Ticker keeps last-known prices on background failures.
      retry: 1,
    }),
};
