/**
 * Terminal settings persistence (localStorage-backed, mirroring the
 * color-scheme-context storage pattern). The /settings view edits these;
 * they persist as one JSON blob under a single key. Readers must merge
 * over DEFAULT_TERMINAL_SETTINGS so partially-stored shapes keep working
 * as the settings surface grows.
 *
 * Reactivity: `subscribeTerminalSettings` lets consumers re-read when the
 * blob changes — a settings edit takes effect in the header clock, ticker
 * bar, compact layout and sound engine without a reload. Components should
 * prefer the `useTerminalSettings` hook, which wraps this subscription.
 *
 * Server-enforced values (consensus quorum, daily-loss cap, max open
 * positions, debug mode, heartbeat interval) are NOT stored here — they
 * live in the runtime_settings DB row via /api/settings/runtime, because
 * the pipeline enforces them. This store holds display/notification
 * preferences that are inherently per-device.
 */

export interface TerminalSettings {
  // Display & interface
  timezone: string;
  baseCurrency: string;
  compactMode: boolean;
  animationsEnabled: boolean;
  tickerBarEnabled: boolean;
  soundEnabled: boolean;
  // Notifications
  tradeAlerts: boolean;
  signalAlerts: boolean;
  riskAlerts: boolean;
  agentStatusAlerts: boolean;
  consensusAlerts: boolean;
  alertThreshold: number;
  // Agent configuration (client-side: only effect is the new-strategy form default)
  defaultLlm: string;
}

export const DEFAULT_TERMINAL_SETTINGS: TerminalSettings = {
  // Display & interface
  timezone: "UTC",
  baseCurrency: "USD",
  compactMode: false,
  animationsEnabled: true,
  tickerBarEnabled: true,
  soundEnabled: false,
  // Notifications
  tradeAlerts: true,
  signalAlerts: true,
  riskAlerts: true,
  agentStatusAlerts: true,
  consensusAlerts: false,
  alertThreshold: 70,
  // Agent configuration
  defaultLlm: "GOOGLE",
};

const STORAGE_KEY = "viipers_terminal_settings";

type Listener = (settings: TerminalSettings) => void;
const listeners = new Set<Listener>();

function readStore(): TerminalSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return DEFAULT_TERMINAL_SETTINGS;
    }
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      return {
        ...DEFAULT_TERMINAL_SETTINGS,
        ...(parsed as Partial<TerminalSettings>),
      };
    }
  } catch {
    // localStorage/JSON can throw in private browsing or storage-restricted
    // contexts; fall back to defaults rather than crashing the settings view
  }
  return DEFAULT_TERMINAL_SETTINGS;
}

export function loadTerminalSettings(): TerminalSettings {
  if (typeof window === "undefined") {
    return DEFAULT_TERMINAL_SETTINGS;
  }
  return readStore();
}

function emit(settings: TerminalSettings): void {
  for (const listener of listeners) {
    try {
      listener(settings);
    } catch {
      // A broken listener must never break the writer.
    }
  }
}

export function saveTerminalSettings(settings: TerminalSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // ignore write failures (quota exceeded, storage disabled, etc.)
  }
  emit(settings);
  // DOM-event channel for non-React consumers (terminal layout applies
  // compact-mode/animation attributes without re-rendering providers).
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("viipers:settings-changed"));
  }
}

/** Subscribe to settings changes; returns an unsubscribe function. */
export function subscribeTerminalSettings(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
