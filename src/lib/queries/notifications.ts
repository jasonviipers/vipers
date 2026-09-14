"use client";

import {
  queryOptions,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { getStoredApiKey } from "@/lib/api-key";

/**
 * Server-synced notification read state.
 *
 * GET  /api/notifications/read-state → { eventIds, synced }
 * PUT  /api/notifications/read-state → marks event ids read (idempotent)
 *
 * `synced: false` means the caller has no API key (or an invalid one); the
 * bell then falls back to localStorage-only reads. All mark-read operations
 * are optimistic: the UI updates immediately, rolls back on error, and
 * reconciles with the server on settle (see the optimistic-updates skill).
 */

export interface ReadStateResponse {
  eventIds: string[];
  /** False = unauthenticated; client falls back to local-only reads. */
  synced: boolean;
}

export const notificationKeys = {
  all: ["notifications"] as const,
  readState: () => [...notificationKeys.all, "read-state"] as const,
};

async function fetchJson<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`API ${response.status}: ${detail || response.statusText}`);
  }
  return (await response.json()) as T;
}

/**
 * Terminal auth sends the API key via header, mirroring evlog-auth's
 * `x-api-key` / Bearer convention.
 */
function authHeaders(): Record<string, string> {
  const key = getStoredApiKey();
  return key ? { "x-api-key": key } : {};
}

export const notificationQueries = {
  readState: () =>
    queryOptions({
      queryKey: notificationKeys.readState(),
      queryFn: async ({ signal }) => {
        const key = getStoredApiKey();
        if (!key) {
          // Not signed in — skip the request entirely; local-only mode.
          return { eventIds: [], synced: false } satisfies ReadStateResponse;
        }
        return fetchJson<ReadStateResponse>("/api/notifications/read-state", {
          headers: authHeaders(),
          signal,
        });
      },
      staleTime: 60_000,
    }),
};

/** Snapshot of every notification read-state cache entry, for rollback. */
interface ReadStateSnapshot {
  key: readonly unknown[];
  data: ReadStateResponse;
}

function snapshotReadState(
  queryClient: ReturnType<typeof useQueryClient>,
): ReadStateSnapshot[] {
  const queries = queryClient
    .getQueryCache()
    .findAll({ queryKey: notificationKeys.all, exact: false });
  const snapshots: ReadStateSnapshot[] = [];
  for (const query of queries) {
    const data = queryClient.getQueryData<ReadStateResponse>(query.queryKey);
    if (data) {
      snapshots.push({ data, key: query.queryKey });
    }
  }
  return snapshots;
}

function patchReadState(
  queryClient: ReturnType<typeof useQueryClient>,
  map: (ids: string[]) => string[],
) {
  const queries = queryClient
    .getQueryCache()
    .findAll({ queryKey: notificationKeys.all, exact: false });
  for (const query of queries) {
    const data = queryClient.getQueryData<ReadStateResponse>(query.queryKey);
    if (!data) continue;
    queryClient.setQueryData<ReadStateResponse>(query.queryKey, {
      ...data,
      eventIds: map(data.eventIds),
    });
  }
}

/**
 * True when the client has a terminal API key, i.e. mutations can actually
 * sync. Gates the optimistic path so unauthenticated sessions don't spin
 * on doomed requests. Set after mount (SSR-safe: sessionStorage is only
 * touched client-side).
 */
export function useHasSyncableAuth(): boolean | null {
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  useEffect(() => {
    setHasKey(getStoredApiKey() !== null);
  }, []);
  return hasKey;
}

type MarkVariables = { eventIds: string[] };

function useMarkReadBase(mode: "single" | "bulk") {
  const queryClient = useQueryClient();
  const hasKey = useHasSyncableAuth();

  return useMutation({
    mutationFn: async ({ eventIds }: MarkVariables) => {
      const response = await fetch("/api/notifications/read-state", {
        body: JSON.stringify({ eventIds }),
        headers: { "content-type": "application/json", ...authHeaders() },
        method: "PUT",
      });
      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new Error(
          `Mark-read failed: ${response.status} ${detail || response.statusText}`,
        );
      }
      return (await response.json()) as { marked: number; ok: true };
    },

    onMutate: async ({ eventIds }) => {
      if (!hasKey) {
        // Local-only mode: nothing to sync, nothing to snapshot.
        return { snapshots: [] as ReadStateSnapshot[], localOnly: true };
      }

      await queryClient.cancelQueries({
        queryKey: notificationKeys.readState(),
      });
      const snapshots = snapshotReadState(queryClient);
      patchReadState(queryClient, (ids) => [...new Set([...ids, ...eventIds])]);
      return { snapshots, localOnly: false };
    },

    onError: (_error, _variables, context) => {
      if (context && !context.localOnly) {
        for (const { data, key } of context.snapshots) {
          queryClient.setQueryData(key, data);
        }
      }
    },

    onSettled: () => {
      if (hasKey) {
        // Reconcile with server ground truth.
        queryClient.invalidateQueries({
          queryKey: notificationKeys.readState(),
        });
      }
    },
    // `mode` is a behavior discriminator, not a request input.
    ...({ mode } as { mode: "single" | "bulk" }),
  });
}

/** Mark one or more events read (individual click and mark-all share it). */
export function useMarkNotificationsRead() {
  const base = useMarkReadBase("single");
  return {
    ...base,
    mutate: (variables: MarkVariables) => base.mutate(variables),
  };
}
