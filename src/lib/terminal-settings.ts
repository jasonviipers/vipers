/**
 * Terminal-wide settings persistence (localStorage-backed, mirroring the
 * color-scheme-context storage pattern). The /settings view edits these;
 * they persist as one JSON blob under a single key. Readers must merge
 * over DEFAULT_TERMINAL_SETTINGS so partially-stored shapes keep working
 * as the settings surface grows.
 */
export interface TerminalSettings {
  // Display & interface
  timezone: string;
  baseCurrency: string;
  compactMode: boolean;
  animationsEnabled: boolean;
  tickerBarEnabled: boolean;
  soundEnabled: boolean;
  // Risk management
  maxDailyDrawdown: number;
  maxOpenPositions: number;
  defaultStopLoss: number;
  defaultTakeProfit: number;
  autoHedge: boolean;
  killSwitchEnabled: boolean;
  // Notifications
  tradeAlerts: boolean;
  signalAlerts: boolean;
  riskAlerts: boolean;
  agentStatusAlerts: boolean;
  consensusAlerts: boolean;
  alertThreshold: number;
  // Agent configuration
  defaultLlm: string;
  consensusQuorum: number;
  heartbeatInterval: number;
  autoRestart: boolean;
  debugMode: boolean;
}

export const DEFAULT_TERMINAL_SETTINGS: TerminalSettings = {
  // Display & interface
  timezone: "UTC",
  baseCurrency: "USD",
  compactMode: false,
  animationsEnabled: true,
  tickerBarEnabled: true,
  soundEnabled: false,
  // Risk management
  maxDailyDrawdown: 10,
  maxOpenPositions: 10,
  defaultStopLoss: 5,
  defaultTakeProfit: 15,
  autoHedge: false,
  killSwitchEnabled: false,
  // Notifications
  tradeAlerts: true,
  signalAlerts: true,
  riskAlerts: true,
  agentStatusAlerts: true,
  consensusAlerts: false,
  alertThreshold: 70,
  // Agent configuration
  defaultLlm: "GOOGLE",
  consensusQuorum: 70,
  heartbeatInterval: 30,
  autoRestart: true,
  debugMode: false,
};

const STORAGE_KEY = "viipers_terminal_settings";

export function loadTerminalSettings(): TerminalSettings {
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

export function saveTerminalSettings(settings: TerminalSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // ignore write failures (quota exceeded, storage disabled, etc.)
  }
}
