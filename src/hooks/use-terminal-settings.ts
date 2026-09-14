"use client";

import { useEffect, useState } from "react";

import {
  loadTerminalSettings,
  subscribeTerminalSettings,
  type TerminalSettings,
} from "@/lib/terminal-settings";

/**
 * Reactive client settings: re-renders whenever the /settings blob is saved
 * (same tab via the subscribe layer, other tabs via the storage event).
 * Consumers get live updates for timezone, ticker-bar visibility, compact
 * mode and sound toggles without a reload.
 */
export function useTerminalSettings(): TerminalSettings {
  const [settings, setSettings] = useState<TerminalSettings>(() =>
    loadTerminalSettings(),
  );

  useEffect(() => {
    setSettings(loadTerminalSettings());
    const unsubscribe = subscribeTerminalSettings(setSettings);
    const onStorage = (e: StorageEvent) => {
      if (e.key === "viipers_terminal_settings") {
        setSettings(loadTerminalSettings());
      }
    };
    window.addEventListener("storage", onStorage);
    return () => {
      unsubscribe();
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  return settings;
}
