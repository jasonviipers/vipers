"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  type StrategyDto,
  type StrategyInput,
  strategyInputSchema,
  strategyKeys,
} from "@/lib/queries/strategies";

/**
 * Strategy mutations are write-capable, so they require a valid session on
 * the server (403 for read-only demo / read-only agents). Auth is carried by
 * the HttpOnly session cookie; the client never sends a raw key header.
 */
function authHeaders(): Record<string, string> {
  return {};
}

type ListCaches = { key: readonly unknown[]; data: StrategiesListSnapshot }[];
interface StrategiesListSnapshot {
  items: StrategyDto[];
}

function snapshotLists(queryClient: ReturnType<typeof useQueryClient>) {
  const queries = queryClient
    .getQueryCache()
    .findAll({ queryKey: strategyKeys.lists(), exact: false });
  const snapshots: ListCaches = [];
  for (const query of queries) {
    const data = queryClient.getQueryData<StrategiesListSnapshot>(
      query.queryKey,
    );
    if (data) {
      snapshots.push({ data, key: query.queryKey });
    }
  }
  return snapshots;
}

function restoreLists(
  queryClient: ReturnType<typeof useQueryClient>,
  snapshots: ListCaches,
) {
  for (const { data, key } of snapshots) {
    queryClient.setQueryData(key, data);
  }
}

function patchLists(
  queryClient: ReturnType<typeof useQueryClient>,
  map: (s: StrategyDto) => StrategyDto,
) {
  const queries = queryClient
    .getQueryCache()
    .findAll({ queryKey: strategyKeys.lists(), exact: false });
  for (const query of queries) {
    const data = queryClient.getQueryData<StrategiesListSnapshot>(
      query.queryKey,
    );
    if (!data) continue;
    queryClient.setQueryData<StrategiesListSnapshot>(query.queryKey, {
      ...data,
      items: data.items.map(map),
    });
  }
}

/** CREATE — optimistic insert with a temp row, rolled back on error. */
export function useCreateStrategy() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: StrategyInput) => {
      const response = await fetch("/api/strategies", {
        body: JSON.stringify(input),
        headers: { "content-type": "application/json", ...authHeaders() },
        method: "POST",
      });
      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new Error(`Create failed: ${response.status} ${detail}`);
      }
      return (await response.json()) as { strategy: StrategyDto };
    },

    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: strategyKeys.all });

      const snapshots = snapshotLists(queryClient);
      const optimistic: StrategyDto = {
        ...input,
        createdAt: new Date().toISOString(),
        id: `optimistic-strategy-${Date.now()}`,
      };

      const queries = queryClient
        .getQueryCache()
        .findAll({ queryKey: strategyKeys.lists(), exact: false });
      for (const query of queries) {
        const data = queryClient.getQueryData<StrategiesListSnapshot>(
          query.queryKey,
        );
        if (!data) continue;
        queryClient.setQueryData<StrategiesListSnapshot>(query.queryKey, {
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
      // Reconcile with server ground truth (real uuid replaces temp id).
      queryClient.invalidateQueries({ queryKey: strategyKeys.lists() });
    },
  });
}

/** UPDATE — optimistic field patch, rollback restores the previous row. */
export function useUpdateStrategy() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, input }: { id: string; input: StrategyInput }) => {
      const response = await fetch(`/api/strategies/${id}`, {
        body: JSON.stringify(input),
        headers: { "content-type": "application/json", ...authHeaders() },
        method: "PATCH",
      });
      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new Error(`Update failed: ${response.status} ${detail}`);
      }
      return (await response.json()) as { strategy: StrategyDto };
    },

    onMutate: async ({ id, input }) => {
      await queryClient.cancelQueries({ queryKey: strategyKeys.all });

      const snapshots = snapshotLists(queryClient);
      patchLists(queryClient, (s) =>
        s.id === id ? { ...s, ...input, id, createdAt: s.createdAt } : s,
      );

      return { snapshots };
    },

    onError: (_error, _variables, context) => {
      if (context?.snapshots) {
        restoreLists(queryClient, context.snapshots);
      }
    },

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: strategyKeys.lists() });
    },
  });
}

/** TOGGLE — narrow optimistic patch of just the active flag. */
export function useToggleStrategy() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ active, id }: { active: boolean; id: string }) => {
      const response = await fetch(`/api/strategies/${id}`, {
        body: JSON.stringify({ active }),
        headers: { "content-type": "application/json", ...authHeaders() },
        method: "PATCH",
      });
      if (!response.ok) {
        throw new Error(`Toggle failed: ${response.status}`);
      }
      return (await response.json()) as { strategy: StrategyDto };
    },

    onMutate: async ({ active, id }) => {
      await queryClient.cancelQueries({ queryKey: strategyKeys.all });
      const snapshots = snapshotLists(queryClient);
      patchLists(queryClient, (s) => (s.id === id ? { ...s, active } : s));
      return { snapshots };
    },

    onError: (_error, _variables, context) => {
      if (context?.snapshots) {
        restoreLists(queryClient, context.snapshots);
      }
    },

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: strategyKeys.lists() });
    },
  });
}

/** DELETE — optimistic removal, rollback restores the row. */
export function useDeleteStrategy() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id }: { id: string }) => {
      const response = await fetch(`/api/strategies/${id}`, {
        headers: authHeaders(),
        method: "DELETE",
      });
      if (!response.ok) {
        throw new Error(`Delete failed: ${response.status}`);
      }
      return { ok: true as const };
    },

    onMutate: async ({ id }) => {
      await queryClient.cancelQueries({ queryKey: strategyKeys.all });

      const snapshots = snapshotLists(queryClient);
      const queries = queryClient
        .getQueryCache()
        .findAll({ queryKey: strategyKeys.lists(), exact: false });
      for (const query of queries) {
        const data = queryClient.getQueryData<StrategiesListSnapshot>(
          query.queryKey,
        );
        if (!data) continue;
        queryClient.setQueryData<StrategiesListSnapshot>(query.queryKey, {
          ...data,
          items: data.items.filter((s) => s.id !== id),
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
      queryClient.invalidateQueries({ queryKey: strategyKeys.lists() });
    },
  });
}

// Re-export so client code validates form payloads against the exact
// contract the API enforces before sending anything.
export { strategyInputSchema };
export type { StrategyInput, StrategyDto };
