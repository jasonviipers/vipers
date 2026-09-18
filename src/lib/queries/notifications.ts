"use client";

import {
  queryOptions,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { useState } from "react";
import { getClientSession } from "@/lib/api-key";

/**
 * Server-synced notification read state.
 *
 * GET  /api/notifications/read-state → { eventIds, synced }
 * PUT  /api/notifications/read-state → marks event ids read (idempotent)
 *
 * Auth rides the HttpOnly session cookie; `synced: false` means the caller
 * has no session and the bell falls back to localStorage-only reads. All
 * mark-read operations are optimistic: the UI updates immediately, rolls
 * back on error, and reconciles with the server on settle (see the
 * optimistic-updates skill).
 */

interface ReadStateResponse {
  eventIds: string[];
  /** False = unauthenticated; client falls back to local-only reads. */
  synced: boolean;
}

const notificationKeys = {
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
 * Session auth is carried by the HttpOnly cookie; the client never sends a
 * raw key (and never stores one).
 */
function authHeaders(): Record<string, string> {
  return {};
}

export const notificationQueries = {
  readState: () =>
    queryOptions({
      queryKey: notificationKeys.readState(),
      queryFn: async ({ signal }) => {
        if (!getClientSession()) {
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

function isReadState(data: unknown): data is ReadStateResponse {
  return (
    typeof data === "object" &&
    data !== null &&
    Array.isArray((data as ReadStateResponse).eventIds) &&
    typeof (data as ReadStateResponse).synced === "boolean"
  );
}

function readStateEntries(queryClient: ReturnType<typeof useQueryClient>) {
  const queries = queryClient
    .getQueryCache()
    .findAll({ queryKey: notificationKeys.all, exact: false });
  // The prefix also matches unrelated entries under ["notifications"]
  // (e.g. the local-reads string[] cache), so shape-check each one —
  // mapping over a non-ReadState entry would throw and abort the mutation.
  return queries.flatMap((query) => {
    const data = queryClient.getQueryData(query.queryKey);
    return isReadState(data) ? [{ data, key: query.queryKey }] : [];
  });
}

function snapshotReadState(
  queryClient: ReturnType<typeof useQueryClient>,
): ReadStateSnapshot[] {
  return readStateEntries(queryClient);
}

function patchReadState(
  queryClient: ReturnType<typeof useQueryClient>,
  map: (ids: string[]) => string[],
) {
  for (const { data, key } of readStateEntries(queryClient)) {
    queryClient.setQueryData<ReadStateResponse>(key, {
      ...data,
      eventIds: map(data.eventIds),
    });
  }
}

/**
 * True when the client has an active session marker, i.e. mutations can
 * actually sync. Gates the optimistic path so unauthenticated sessions don't
 * spin on doomed requests. Set after mount (SSR-safe: sessionStorage is only
 * touched client-side).
 */
export function useHasSyncableAuth(): boolean | null {
  const [hasKey] = useState<boolean | null>(() => {
    if (typeof window === "undefined") return null;
    return getClientSession() !== null;
  });
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
