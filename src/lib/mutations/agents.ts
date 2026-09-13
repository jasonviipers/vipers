"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import type {
  AgentDto,
  AgentListResponse,
  AgentStatus,
  AgentTeam,
} from "@/lib/queries/agents";
import { agentKeys } from "@/lib/queries/agents";

const OPTIMISTIC_PREFIX = "optimistic-agent-";

function makeTempId() {
  return `${OPTIMISTIC_PREFIX}${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function isOptimisticId(id: string) {
  return id.startsWith(OPTIMISTIC_PREFIX);
}

/** Patch every cached agent list with a mapper. */
function patchAgentLists(
  queryClient: ReturnType<typeof useQueryClient>,
  map: (agent: AgentDto) => AgentDto,
) {
  // TanStack Query v5: predicate-based patching catches all filter
  // variants of the list key without enumerating them.
  const queries = queryClient.getQueryCache().findAll({
    queryKey: agentKeys.lists(),
    exact: false,
  });
  for (const query of queries) {
    const data = queryClient.getQueryData<AgentListResponse>(query.queryKey);
    if (!data) continue;
    queryClient.setQueryData<AgentListResponse>(query.queryKey, {
      ...data,
      items: data.items.map(map),
    });
  }
}

function snapshotLists(queryClient: ReturnType<typeof useQueryClient>) {
  const queries = queryClient.getQueryCache().findAll({
    queryKey: agentKeys.lists(),
    exact: false,
  });
  const snapshots = queries
    .map((query) => ({
      key: query.queryKey,
      data: queryClient.getQueryData<AgentListResponse>(query.queryKey),
    }))
    .filter(
      (
        entry,
      ): entry is {
        key: ReturnType<typeof agentKeys.list>;
        data: AgentListResponse;
      } => entry.data !== undefined,
    );
  return snapshots;
}

function restoreLists(
  queryClient: ReturnType<typeof useQueryClient>,
  snapshots: ReturnType<typeof snapshotLists>,
) {
  for (const { key, data } of snapshots) {
    queryClient.setQueryData(key, data);
  }
}

/** CREATE — optimistic insert with a temporary id, rollback on error. */
export function useCreateAgent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      name: string;
      role: string;
      team: AgentTeam;
    }) => {
      const response = await fetch("/api/agents", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!response.ok) {
        throw new Error(`Create failed: ${response.status}`);
      }
      return (await response.json()) as { agent: AgentDto };
    },
    onMutate: async (variables) => {
      await queryClient.cancelQueries({ queryKey: agentKeys.all });

      const snapshots = snapshotLists(queryClient);

      const optimistic: AgentDto = {
        id: makeTempId(),
        name: variables.name,
        role: variables.role,
        team: variables.team,
        status: "offline",
        createdAt: new Date().toISOString(),
        lastHeartbeatAt: null,
      };

      const queries = queryClient.getQueryCache().findAll({
        queryKey: agentKeys.lists(),
        exact: false,
      });
      for (const query of queries) {
        const data = queryClient.getQueryData<AgentListResponse>(
          query.queryKey,
        );
        if (!data) continue;
        queryClient.setQueryData<AgentListResponse>(query.queryKey, {
          ...data,
          items: [optimistic, ...data.items],
        });
      }

      return { snapshots };
    },

    onError: (_error, _variables, context) => {
      if (context?.snapshots) {
        restoreLists(queryClient, context.snapshots);
      }
    },

    onSettled: () => {
      // Reconcile with server ground truth (real id replaces temp id).
      queryClient.invalidateQueries({ queryKey: agentKeys.lists() });
    },
  });
}

/** UPDATE (status toggle) — optimistic field patch on list + detail. */
export function useUpdateAgentStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { id: string; status: AgentStatus }) => {
      const response = await fetch(`/api/agents/${input.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: input.status }),
      });
      if (!response.ok) {
        throw new Error(`Update failed: ${response.status}`);
      }
      return (await response.json()) as { agent: AgentDto };
    },

    onMutate: async ({ id, status }) => {
      await queryClient.cancelQueries({ queryKey: agentKeys.all });

      const snapshots = snapshotLists(queryClient);
      const previousDetail = queryClient.getQueryData<{
        agent: AgentDto;
      }>(agentKeys.detail(id));

      patchAgentLists(queryClient, (agent) =>
        agent.id === id ? { ...agent, status } : agent,
      );

      const detailKey = agentKeys.detail(id);
      if (previousDetail) {
        queryClient.setQueryData(detailKey, {
          ...previousDetail,
          agent: { ...previousDetail.agent, status },
        });
      }

      return { snapshots, previousDetail, detailKey };
    },

    onError: (_error, _variables, context) => {
      if (context?.snapshots) {
        restoreLists(queryClient, context.snapshots);
      }
      if (context?.previousDetail && context.detailKey) {
        queryClient.setQueryData(context.detailKey, context.previousDetail);
      }
    },

    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: agentKeys.lists() });
      // Targeted: only this agent's detail, not all details.
      queryClient.invalidateQueries({
        queryKey: agentKeys.detail(variables.id),
      });
    },
  });
}

/** DELETE — optimistic removal, rollback restores the row. */
export function useDeleteAgent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { id: string }) => {
      const response = await fetch(`/api/agents/${input.id}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        throw new Error(`Delete failed: ${response.status}`);
      }
      return { ok: true as const };
    },
    onMutate: async ({ id }) => {
      await queryClient.cancelQueries({ queryKey: agentKeys.all });

      const snapshots = snapshotLists(queryClient);

      const queries = queryClient.getQueryCache().findAll({
        queryKey: agentKeys.lists(),
        exact: false,
      });
      for (const query of queries) {
        const data = queryClient.getQueryData<AgentListResponse>(
          query.queryKey,
        );
        if (!data) continue;
        queryClient.setQueryData<AgentListResponse>(query.queryKey, {
          ...data,
          items: data.items.filter((a) => a.id !== id),
        });
      }

      return { snapshots };
    },

    onError: (_error, _variables, context) => {
      if (context?.snapshots) {
        restoreLists(queryClient, context.snapshots);
      }
    },

    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: agentKeys.lists() });
      queryClient.removeQueries({
        queryKey: agentKeys.detail(variables.id),
      });
    },
  });
}

export { isOptimisticId };
