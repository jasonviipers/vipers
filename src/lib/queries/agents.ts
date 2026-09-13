import { queryOptions } from "@tanstack/react-query";

/**
 * Domain-shaped query keys, built from factory functions.
 * Hierarchy: ["agents", "list", filters] / ["agents", "detail", id]
 * so targeted invalidation works: invalidating ["agents"] catches
 * everything, ["agents", "list"] only lists, and detail keys stay
 * untouched during list-only refetches.
 */
export const agentKeys = {
  all: ["agents"] as const,
  lists: () => [...agentKeys.all, "list"] as const,
  list: (filters: AgentListFilters) => [...agentKeys.lists(), filters] as const,
  details: () => [...agentKeys.all, "detail"] as const,
  detail: (id: string) => [...agentKeys.details(), id] as const,
};

export type AgentStatus = (typeof agentStatusEnumValues)[number];
export type AgentTeam = (typeof agentTeamEnumValues)[number];

// Keep in sync with src/db/schema/agent.ts (agentStatusEnum).
const agentStatusEnumValues = ["online", "offline", "error", "busy"] as const;

// Keep in sync with src/db/schema/agent.ts (teamEnum).
const agentTeamEnumValues = [
  "SENTIMENT",
  "ANALYSIS",
  "EXECUTION",
  "RISK",
  "COORDINATION",
] as const;

export interface AgentDto {
  id: string;
  name: string;
  role: string;
  team: AgentTeam;
  status: AgentStatus;
  createdAt: string;
  lastHeartbeatAt: string | null;
}

export interface AgentListFilters {
  team?: AgentTeam;
  status?: AgentStatus;
}

export interface AgentListResponse {
  items: AgentDto[];
  total: number;
}

async function fetchJson<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init?.headers,
    },
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`API ${response.status}: ${detail || response.statusText}`);
  }
  return (await response.json()) as T;
}

export const agentQueries = {
  list: (filters: AgentListFilters) =>
    queryOptions({
      queryKey: agentKeys.list(filters),
      queryFn: () => {
        const params = new URLSearchParams();
        if (filters.team) params.set("team", filters.team);
        if (filters.status) params.set("status", filters.status);
        const qs = params.toString();
        return fetchJson<AgentListResponse>(`/api/agents${qs ? `?${qs}` : ""}`);
      },
    }),

  detail: (id: string) =>
    queryOptions({
      queryKey: agentKeys.detail(id),
      queryFn: () => fetchJson<{ agent: AgentDto }>(`/api/agents/${id}`),
      enabled: Boolean(id),
    }),
};
