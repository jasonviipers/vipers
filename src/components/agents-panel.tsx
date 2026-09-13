"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { parseAsStringLiteral, useQueryStates } from "nuqs";
import {
  isOptimisticId,
  useCreateAgent,
  useDeleteAgent,
  useUpdateAgentStatus,
} from "@/lib/mutations/agents";
import type { AgentStatus } from "@/lib/queries/agents";
import { agentQueries } from "@/lib/queries/agents";

const TEAMS = [
  "SENTIMENT",
  "ANALYSIS",
  "EXECUTION",
  "RISK",
  "COORDINATION",
] as const;
const STATUSES = ["online", "offline", "error", "busy"] as const;

const agentsFilters = {
  team: parseAsStringLiteral(TEAMS),
  status: parseAsStringLiteral(STATUSES),
};

const STATUS_CYCLE: Record<string, AgentStatus> = {
  online: "busy",
  busy: "offline",
  offline: "online",
  error: "online",
};

export function AgentsPanel() {
  const [{ team, status }, setFilters] = useQueryStates(agentsFilters);

  const filters = { team: team ?? undefined, status: status ?? undefined };
  const listQuery = useQuery(agentQueries.list(filters));
  const hasFilters = Boolean(team || status);

  const createAgent = useCreateAgent();
  const updateStatus = useUpdateAgentStatus();
  const deleteAgent = useDeleteAgent();

  return (
    <section className="mx-auto w-full max-w-3xl space-y-6 p-8">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Agents</h1>
          <p className="text-sm text-neutral-500">
            Server state via TanStack Query — URL-backed filters via nuqs
          </p>
        </div>
        <button
          type="button"
          className="rounded border px-3 py-1.5 text-sm hover:bg-neutral-100 disabled:opacity-50"
          onClick={() =>
            createAgent.mutate({
              name: `Agent ${Math.floor(Math.random() * 1000)}`,
              role: "scout",
              team: "ANALYSIS",
            })
          }
          disabled={createAgent.isPending}
        >
          + Add agent
        </button>
      </header>

      {/* State indicators — background refetch + stale data are visible */}
      <div className="flex flex-wrap items-center gap-3 text-xs text-neutral-500">
        {listQuery.isFetching && (
          <span data-testid="bg-refetch" className="text-blue-600">
            ⟳ {listQuery.dataUpdatedAt > 0 ? "background refetch" : "loading"}…
          </span>
        )}
        {listQuery.isStale && !listQuery.isFetching && (
          <span data-testid="stale" className="text-amber-600">
            stale
          </span>
        )}
        <span>
          dataAge:{" "}
          {listQuery.dataUpdatedAt
            ? new Date(listQuery.dataUpdatedAt).toLocaleTimeString()
            : "—"}
        </span>
        <button
          type="button"
          className="underline hover:text-neutral-800"
          onClick={() => listQuery.refetch()}
        >
          refetch
        </button>
        {hasFilters && (
          <button
            type="button"
            className="underline hover:text-neutral-800"
            onClick={() => setFilters(null)}
          >
            clear filters
          </button>
        )}
      </div>

      {/* Filters — nuqs writes them to the URL (?team=…&status=…) */}
      <div className="flex gap-2">
        <select
          value={team ?? ""}
          onChange={(e) =>
            setFilters({
              team: (e.target.value || null) as typeof team,
            })
          }
          className="rounded border px-2 py-1 text-sm"
        >
          <option value="">All teams</option>
          {TEAMS.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <select
          value={status ?? ""}
          onChange={(e) =>
            setFilters({
              status: (e.target.value || null) as typeof status,
            })
          }
          className="rounded border px-2 py-1 text-sm"
        >
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      {/* --- The five states --- */}
      {listQuery.isPending ? (
        <ul className="space-y-2" data-testid="loading">
          {[0, 1, 2].map((i) => (
            <li key={i} className="h-14 animate-pulse rounded bg-neutral-100" />
          ))}
        </ul>
      ) : listQuery.isError ? (
        <div
          data-testid="error"
          className="rounded border border-red-200 bg-red-50 p-4 text-sm"
        >
          <p className="font-medium text-red-700">Failed to load agents</p>
          <p className="text-red-600">{listQuery.error.message}</p>
          <button
            type="button"
            className="mt-2 rounded border border-red-300 px-2 py-1 hover:bg-red-100"
            onClick={() => listQuery.refetch()}
          >
            Retry
          </button>
        </div>
      ) : listQuery.data.items.length === 0 ? (
        <div
          data-testid="empty"
          className="rounded border border-dashed p-8 text-center text-sm text-neutral-500"
        >
          {hasFilters
            ? "No agents match these filters."
            : "No agents yet — add one to get started."}
        </div>
      ) : (
        <ul className="space-y-2" data-testid="list">
          {listQuery.data.items.map((agent) => (
            <li
              key={agent.id}
              className={`flex items-center justify-between rounded border px-4 py-3 ${
                isOptimisticId(agent.id)
                  ? "border-blue-300 bg-blue-50 opacity-70"
                  : ""
              }`}
            >
              <div>
                <p className="text-sm font-medium">
                  {agent.name}
                  {isOptimisticId(agent.id) && (
                    <span className="ml-2 rounded bg-blue-200 px-1.5 py-0.5 text-[10px] uppercase">
                      saving…
                    </span>
                  )}
                </p>
                <p className="text-xs text-neutral-500">
                  {agent.team} · {agent.role}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="rounded bg-neutral-100 px-2 py-0.5 text-xs">
                  {agent.status}
                </span>
                <button
                  type="button"
                  className="rounded border px-2 py-1 text-xs hover:bg-neutral-100 disabled:opacity-50"
                  onClick={() =>
                    updateStatus.mutate({
                      id: agent.id,
                      status: STATUS_CYCLE[agent.status],
                    })
                  }
                  disabled={updateStatus.isPending || isOptimisticId(agent.id)}
                >
                  cycle status
                </button>
                <button
                  type="button"
                  className="rounded border px-2 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50"
                  onClick={() => deleteAgent.mutate({ id: agent.id })}
                  disabled={deleteAgent.isPending || isOptimisticId(agent.id)}
                >
                  delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Keep a stable reference for invalidation demos */}
      <InvalidateAll />
    </section>
  );
}

function InvalidateAll() {
  const queryClient = useQueryClient();
  return (
    <button
      type="button"
      className="text-xs text-neutral-400 underline hover:text-neutral-600"
      onClick={() => queryClient.invalidateQueries({ queryKey: ["agents"] })}
    >
      invalidate everything
    </button>
  );
}
