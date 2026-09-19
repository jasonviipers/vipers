import { queryOptions } from "@tanstack/react-query";

export interface FeedEvent {
  id: string;
  category: "consensus" | "trade" | "signal" | "alert" | "heartbeat";
  asset: string | null;
  /** Pre-formatted one-liner; the client renders it verbatim. */
  message: string;
  /** ISO timestamp. */
  timestamp: string;
}

interface FeedResponse {
  /** Newest-first, bounded. */
  items: FeedEvent[];
  onlineCount: number;
  total: number;
}

const feedKeys = {
  all: ["feed"] as const,
  recent: () => [...feedKeys.all, "recent"] as const,
};

async function fetchJson<T>(input: string): Promise<T> {
  const response = await fetch(input);
  if (!response.ok) {
    throw new Error(`API ${response.status}: ${response.statusText}`);
  }
  return (await response.json()) as T;
}

export const feedQueries = {
  /** 10s poll: the feed is process-local runtime events, not DB history. */
  recent: (enabled = true) =>
    queryOptions({
      enabled,
      queryKey: feedKeys.recent(),
      queryFn: () => fetchJson<FeedResponse>("/api/events/recent"),
      refetchInterval: 10_000,
      staleTime: 10_000,
    }),
};
