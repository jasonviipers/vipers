import { queryOptions } from "@tanstack/react-query";

export interface TradeActivityBucket {
  /** Bucket end, ISO string. */
  time: string;
  /** Trade count in the bucket. */
  value: number;
  /** LONG minus SHORT; drives bar coloring. */
  net: number;
}

export interface TradeActivityResponse {
  buckets: TradeActivityBucket[];
  /** "db" = positions table, "events" = runtime event-buffer fallback. */
  source: "db" | "events";
  windowHours: number;
}

export const tradeActivityKeys = {
  all: ["trades-activity"] as const,
  hourly: () => [...tradeActivityKeys.all, "hourly"] as const,
};

async function fetchJson<T>(input: string): Promise<T> {
  const response = await fetch(input);
  if (!response.ok) {
    throw new Error(`API ${response.status}: ${response.statusText}`);
  }
  return (await response.json()) as T;
}

export const tradeActivityQueries = {
  hourly: () =>
    queryOptions({
      queryKey: tradeActivityKeys.hourly(),
      queryFn: () => fetchJson<TradeActivityResponse>("/api/trades/activity"),
      refetchInterval: 60_000,
      staleTime: 60_000,
    }),
};
