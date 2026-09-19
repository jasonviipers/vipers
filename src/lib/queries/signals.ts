import { queryOptions } from "@tanstack/react-query";

export interface SignalActivityBucket {
  /** Bucket end, ISO string. */
  time: string;
  /** Signal count in the bucket. */
  value: number;
  /** Bullish minus bearish; drives bar coloring. */
  net: number;
}

export interface SignalActivityResponse {
  buckets: SignalActivityBucket[];
  /** "db" = signals table, "events" = runtime event-buffer fallback. */
  source: "db" | "events";
  windowHours: number;
}

const signalActivityKeys = {
  all: ["signals-activity"] as const,
  hourly: () => [...signalActivityKeys.all, "hourly"] as const,
  recent: () => [...signalActivityKeys.all, "recent"] as const,
};
export interface RecentSignal {
  id: string;
  asset: string;
  content: string;
  createdAt: string;
  /** 0-100 composite sentiment score; `threshold` lives in terminal settings. */
  score: number;
  sentiment: "bullish" | "bearish" | "neutral";
  source: "reddit" | "twitter" | "rss";
  twitterConfirmed: boolean;
}

export interface RecentSignalsResponse {
  items: RecentSignal[];
  /** "db" = signals table, "events" = runtime event-buffer fallback. */
  source: "db" | "events";
}

async function fetchJson<T>(input: string): Promise<T> {
  const response = await fetch(input);
  if (!response.ok) {
    throw new Error(`API ${response.status}: ${response.statusText}`);
  }
  return (await response.json()) as T;
}

export const signalActivityQueries = {
  /** 60s poll; the window is 24h so minute-level freshness is plenty. */
  hourly: (enabled = true) =>
    queryOptions({
      enabled,
      queryKey: signalActivityKeys.hourly(),
      queryFn: () => fetchJson<SignalActivityResponse>("/api/signals/activity"),
      refetchInterval: 60_000,
      staleTime: 60_000,
    }),

  /** Newest signals for the dashboard SignalFeed; newest-first. */
  recent: (enabled = true) =>
    queryOptions({
      enabled,
      queryKey: signalActivityKeys.recent(),
      queryFn: () => fetchJson<RecentSignalsResponse>("/api/signals/recent"),
      refetchInterval: 30_000,
      staleTime: 30_000,
    }),
};
