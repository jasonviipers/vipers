"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { type FeedEvent, feedQueries } from "@/lib/queries/events";
import {
  notificationQueries,
  useHasSyncableAuth,
  useMarkNotificationsRead,
} from "@/lib/queries/notifications";
import {
  DEFAULT_TERMINAL_SETTINGS,
  loadTerminalSettings,
} from "@/lib/terminal-settings";

/**
 * Shared notification state for every notification surface (header bell,
 * mobile bottom-nav tab). Owns: the events feed query, server-synced read
 * state, the signed-out localStorage fallback, settings-aware filtering,
 * and the mark-read actions. UI components stay thin wrappers; two mounted
 * surfaces stay consistent because all state flows through the shared
 * React Query cache.
 */

const LOCAL_READS_KEY = "viipers_notification_reads";

function readLocalReads(): string[] {
  try {
    const raw = localStorage.getItem(LOCAL_READS_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.filter((v): v is string => typeof v === "string");
      }
    }
  } catch {
    // localStorage/JSON can throw in private browsing contexts; treat as
    // nothing-read rather than crashing the header
  }
  return [];
}

function writeLocalReads(ids: string[]) {
  try {
    // Merge, don't replace: the storage holds the full accumulated read
    // set, and callers pass only the newly-marked ids.
    const merged = [...new Set([...readLocalReads(), ...ids])];
    localStorage.setItem(LOCAL_READS_KEY, JSON.stringify(merged));
  } catch {
    // ignore write failures (quota exceeded, storage disabled, etc.)
  }
}

/** Mark read optimistically against the local store (signed-out mode). */
function useLocalMarkRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (eventIds: string[]) => {
      writeLocalReads(eventIds);
      return { eventIds };
    },
    onMutate: async (eventIds) => {
      // Optimistic: update the local-reads cache entry immediately.
      await queryClient.cancelQueries({
        queryKey: ["notifications", "local-reads"],
      });
      const previous =
        queryClient.getQueryData<string[]>(["notifications", "local-reads"]) ??
        [];
      queryClient.setQueryData<string[]>(
        ["notifications", "local-reads"],
        [...new Set([...previous, ...eventIds])],
      );
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context) {
        queryClient.setQueryData(
          ["notifications", "local-reads"],
          context.previous,
        );
      }
    },
  });
}

/** Settings toggle key per event category (see /settings notifications). */
const CATEGORY_SETTING_KEY: Record<
  FeedEvent["category"],
  | "consensusAlerts"
  | "tradeAlerts"
  | "signalAlerts"
  | "riskAlerts"
  | "agentStatusAlerts"
> = {
  alert: "riskAlerts",
  consensus: "consensusAlerts",
  heartbeat: "agentStatusAlerts",
  signal: "signalAlerts",
  trade: "tradeAlerts",
};

export function formatTimeAgo(iso: string, nowMs: number): string {
  const seconds = Math.max(
    0,
    Math.floor((nowMs - new Date(iso).getTime()) / 1000),
  );
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}

export function useNotifications() {
  const { data: feed } = useQuery(feedQueries.recent());
  const { data: serverReads, isPending: readsPending } = useQuery(
    notificationQueries.readState(),
  );

  // Signed-out fallback: local reads live in a cache entry so optimistic
  // updates flow through the same mutation machinery.
  const { data: localReads } = useQuery({
    queryKey: ["notifications", "local-reads"],
    queryFn: () => readLocalReads(),
    staleTime: Number.POSITIVE_INFINITY,
  });

  const localMarkRead = useLocalMarkRead();
  const markReadMutation = useMarkNotificationsRead();
  const hasKey = useHasSyncableAuth();

  // Respect the /settings notification toggles (localStorage-backed), like
  // the signals view's alert threshold.
  const [settings, setSettings] = useState(DEFAULT_TERMINAL_SETTINGS);
  useEffect(() => {
    setSettings(loadTerminalSettings());
  }, []);

  // Clock tick keeps relative timestamps fresh between fetches.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);

  const items = useMemo(
    () =>
      (feed?.items ?? []).filter(
        (event) => settings[CATEGORY_SETTING_KEY[event.category]],
      ),
    [feed?.items, settings],
  );

  const synced = hasKey === true && serverReads?.synced === true;
  const readIds = synced ? (serverReads?.eventIds ?? []) : (localReads ?? []);

  const isRead = useCallback((id: string) => readIds.includes(id), [readIds]);

  const markRead = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) return;
      if (synced) {
        markReadMutation.mutate({ eventIds: ids });
      } else {
        localMarkRead.mutate(ids);
      }
    },
    [synced, markReadMutation, localMarkRead],
  );

  const unreadItems = items.filter((item) => !isRead(item.id));
  const unreadCount = unreadItems.length;
  const pending = markReadMutation.isPending || localMarkRead.isPending;

  return {
    isRead,
    items,
    markRead,
    now,
    pending,
    readsPending,
    synced,
    unreadCount,
    unreadItems,
  };
}
