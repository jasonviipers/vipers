"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import {
  DEFAULT_TERMINAL_SETTINGS,
  getServerTerminalSettings,
  loadTerminalSettings,
  resetTerminalSettings,
  saveTerminalSettings,
  subscribeTerminalSettings,
  type TerminalSettings,
  type TerminalSettingsSnapshot,
  updateTerminalSettings,
} from "@/lib/terminal-settings";

export interface UseTerminalSettingsResult {
  /** Current settings (defaults during SSR/hydration, then the stored values). */
  settings: TerminalSettingsSnapshot;
  /** Merge a partial patch: `update({ compactMode: true })`. */
  update: (patch: Partial<TerminalSettings>) => void;
  /** Replace everything. Prefer `update` for single-field edits. */
  save: (settings: TerminalSettings) => void;
  /** Restore defaults. */
  reset: () => void;
}

/**
 * Subscribe to all terminal settings. The component re-renders whenever any
 * setting changes, in this tab or another one.
 *
 * Server render and hydration both see DEFAULT_TERMINAL_SETTINGS, so there
 * is no hydration mismatch; React then re-renders with the stored values.
 */
export function useTerminalSettings(): UseTerminalSettingsResult {
  const settings = useSyncExternalStore(
    subscribeTerminalSettings,
    loadTerminalSettings,
    getServerTerminalSettings,
  );

  return useMemo(
    () => ({
      settings,
      update: updateTerminalSettings,
      save: saveTerminalSettings,
      reset: resetTerminalSettings,
    }),
    [settings],
  );
}

/**
 * Subscribe to a single setting. The component only re-renders when that
 * field changes (all fields are primitives, so snapshots compare by value).
 *
 *   const compact = useTerminalSetting("compactMode");
 */
export function useTerminalSetting<K extends keyof TerminalSettings>(
  key: K,
): TerminalSettings[K] {
  const getSnapshot = useCallback(() => loadTerminalSettings()[key], [key]);
  const getServerSnapshot = useCallback(
    () => DEFAULT_TERMINAL_SETTINGS[key],
    [key],
  );
  return useSyncExternalStore(
    subscribeTerminalSettings,
    getSnapshot,
    getServerSnapshot,
  );
}
