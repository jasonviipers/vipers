"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Bell,
  Check,
  ChevronDown,
  Cpu,
  Monitor,
  Palette,
  RotateCcw,
  Settings,
  Shield,
  Wallet,
} from "lucide-react";
import { useEffect, useState } from "react";
import { BrokerAccountsSection } from "@/components/settings/broker-accounts";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  COLOR_SCHEMES,
  type ColorSchemeId,
  useColorScheme,
} from "@/context/color-scheme-context";
import { getStoredApiKey } from "@/lib/api-key";
import {
  DEFAULT_TERMINAL_SETTINGS,
  loadTerminalSettings,
  saveTerminalSettings,
  type TerminalSettings,
} from "@/lib/terminal-settings";

// -- Server-enforced runtime settings (runtime_settings DB row) --------------

interface RuntimeSettings {
  consensusQuorum: number;
  debugMode: boolean;
  heartbeatInterval: number;
  maxDailyLossPct: number;
  maxOpenPositions: number;
}

const RUNTIME_FALLBACK: RuntimeSettings = {
  consensusQuorum: 50,
  debugMode: false,
  heartbeatInterval: 30,
  maxDailyLossPct: 3,
  maxOpenPositions: 10,
};

// -- Section wrapper ----------------------------------------------------------

function SettingsSection({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: React.ElementType;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border border-border bg-card">
      <div className="flex items-center gap-3 border-b border-border bg-secondary/50 px-4 py-2.5">
        <Icon className="h-3.5 w-3.5 text-terminal-green" />
        <div className="flex flex-col">
          <span className="text-xs font-bold tracking-wider text-foreground">
            {title}
          </span>
          <span className="text-[10px] text-muted-foreground">
            {description}
          </span>
        </div>
      </div>
      <div className="flex flex-col gap-4 p-4">{children}</div>
    </div>
  );
}

function ToggleRow({
  label,
  description,
  value,
  onChange,
}: {
  label: string;
  description?: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex flex-col gap-0.5">
        <span className="text-xs font-bold text-foreground">{label}</span>
        {description && (
          <span className="text-[10px] text-muted-foreground">
            {description}
          </span>
        )}
      </div>
      <button
        type="button"
        onClick={() => onChange(!value)}
        className={`relative h-5 w-9 shrink-0 border transition-colors ${
          value
            ? "border-terminal-green/40 bg-terminal-green/20"
            : "border-border bg-secondary"
        }`}
      >
        <div
          className={`absolute top-0.5 h-3.5 w-3.5 transition-all ${
            value ? "left-4.5 bg-terminal-green" : "left-0.5 bg-terminal-dim"
          }`}
        />
      </button>
    </div>
  );
}

function InlineSelect({
  label,
  description,
  value,
  options,
  onChange,
}: {
  label: string;
  description?: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex flex-col gap-0.5">
        <span className="text-xs font-bold text-foreground">{label}</span>
        {description && (
          <span className="text-[10px] text-muted-foreground">
            {description}
          </span>
        )}
      </div>
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="flex items-center gap-2 border border-border bg-secondary px-3 py-1 text-xs text-foreground hover:border-terminal-green/40 transition-colors"
        >
          <span>{value}</span>
          <ChevronDown
            className={`h-3 w-3 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
          />
        </button>
        {open && (
          <div className="absolute right-0 top-full z-50 mt-1 min-w-30 border border-border bg-card shadow-lg shadow-black/40">
            {options.map((opt) => (
              <button
                type="button"
                key={opt}
                onClick={() => {
                  onChange(opt);
                  setOpen(false);
                }}
                className={`flex w-full items-center justify-between px-3 py-1.5 text-xs transition-colors hover:bg-terminal-green/10 ${
                  opt === value ? "text-terminal-green" : "text-foreground"
                }`}
              >
                <span>{opt}</span>
                {opt === value && (
                  <Check className="h-3 w-3 text-terminal-green" />
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SliderRow({
  label,
  description,
  value,
  min,
  max,
  suffix,
  color,
  onChange,
}: {
  label: string;
  description?: string;
  value: number;
  min: number;
  max: number;
  suffix?: string;
  color?: string;
  onChange: (v: number) => void;
}) {
  const pct = ((value - min) / (max - min)) * 100;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-0.5">
          <span className="text-xs font-bold text-foreground">{label}</span>
          {description && (
            <span className="text-[10px] text-muted-foreground">
              {description}
            </span>
          )}
        </div>
        <span className={`text-xs font-bold ${color ?? "text-foreground"}`}>
          {value}
          {suffix ?? ""}
        </span>
      </div>
      <div className="relative h-1.5 w-full bg-secondary border border-border">
        <div
          className="absolute inset-y-0 left-0"
          style={{
            width: `${pct}%`,
            backgroundColor:
              color === "text-terminal-green"
                ? "var(--terminal-green)"
                : color === "text-terminal-red"
                  ? "var(--terminal-red)"
                  : color === "text-terminal-amber"
                    ? "var(--terminal-amber)"
                    : color === "text-terminal-cyan"
                      ? "var(--terminal-cyan)"
                      : "var(--terminal-green)",
          }}
        />
        <input
          type="range"
          min={min}
          max={max}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="absolute inset-0 w-full cursor-pointer opacity-0"
          aria-label={label}
        />
      </div>
    </div>
  );
}

function ColorSchemeSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const current = COLOR_SCHEMES.find((s) => s.id === value) ?? COLOR_SCHEMES[0];

  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex flex-col gap-0.5">
        <span className="text-xs font-bold text-foreground">COLOR SCHEME</span>
        <span className="text-[10px] text-muted-foreground">
          {current.description}
        </span>
      </div>
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="flex items-center gap-2 border border-border bg-secondary px-3 py-1 text-xs text-foreground hover:border-terminal-green/40 transition-colors"
        >
          <span className="flex items-center gap-1.5">
            <span className="flex items-center gap-0.5">
              {Object.values(current.colors)
                .slice(0, 3)
                .map((color) => (
                  <span
                    key={color}
                    className="inline-block h-2 w-2 shrink-0"
                    style={{ backgroundColor: color }}
                  />
                ))}
            </span>
            <span>{current.label}</span>
          </span>
          <ChevronDown
            className={`h-3 w-3 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
          />
        </button>
        {open && (
          <div className="absolute right-0 top-full z-50 mt-1 min-w-45 border border-border bg-card shadow-lg shadow-black/40">
            {COLOR_SCHEMES.map((scheme) => (
              <button
                type="button"
                key={scheme.id}
                onClick={() => {
                  onChange(scheme.id);
                  setOpen(false);
                }}
                className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-xs transition-colors hover:bg-terminal-green/10 ${
                  scheme.id === value
                    ? "text-terminal-green"
                    : "text-foreground"
                }`}
              >
                <span className="flex items-center gap-2">
                  <span className="flex items-center gap-0.5">
                    {Object.values(scheme.colors)
                      .slice(0, 3)
                      .map((color) => (
                        <span
                          key={color}
                          className="inline-block h-2 w-2 shrink-0"
                          style={{ backgroundColor: color }}
                        />
                      ))}
                  </span>
                  <span>{scheme.label}</span>
                </span>
                {scheme.id === value && (
                  <Check className="h-3 w-3 text-terminal-green" />
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function SettingsView() {
  const { scheme: colorScheme, setScheme: setColorScheme } = useColorScheme();
  const [settings, setSettings] = useState<TerminalSettings>(
    DEFAULT_TERMINAL_SETTINGS,
  );
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setSettings(loadTerminalSettings());
  }, []);

  function set<K extends keyof TerminalSettings>(
    key: K,
    value: TerminalSettings[K],
  ) {
    setSettings((prev) => ({ ...prev, [key]: value }));
    // Any draft edit invalidates the previous "Saved" confirmation.
    setSaved(false);
  }

  function handleSave() {
    saveTerminalSettings(settings);
    setSaved(true);
  }

  function handleReset() {
    setSettings(DEFAULT_TERMINAL_SETTINGS);
    setSaved(false);
  }

  // --- Server-enforced runtime settings (optimistic, rollback on error) ----
  const queryClient = useQueryClient();
  const RUNTIME_KEY = ["settings", "runtime"] as const;

  const runtimeQuery = useQuery<RuntimeSettings>({
    queryFn: async () => {
      const res = await fetch("/api/settings/runtime");
      if (!res.ok) {
        throw new Error(`API ${res.status}`);
      }
      return (await res.json()) as RuntimeSettings;
    },
    queryKey: RUNTIME_KEY,
    staleTime: 10_000,
  });

  const runtimeMutation = useMutation({
    mutationFn: async (patch: Partial<RuntimeSettings>) => {
      const key = getStoredApiKey();
      const res = await fetch("/api/settings/runtime", {
        body: JSON.stringify(patch),
        headers: {
          "content-type": "application/json",
          ...(key ? { "x-api-key": key } : {}),
        },
        method: "PUT",
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(`Settings update failed: ${res.status} ${detail}`);
      }
      return (await res.json()) as RuntimeSettings;
    },
    // Optimistic: apply immediately, roll back on failure, reconcile after.
    onMutate: async (patch) => {
      await queryClient.cancelQueries({ queryKey: RUNTIME_KEY });
      const previous =
        queryClient.getQueryData<RuntimeSettings>(RUNTIME_KEY) ??
        RUNTIME_FALLBACK;
      queryClient.setQueryData<RuntimeSettings>(RUNTIME_KEY, {
        ...previous,
        ...patch,
      });
      return { previous };
    },
    onError: (_error, _patch, context) => {
      if (context?.previous) {
        queryClient.setQueryData(RUNTIME_KEY, context.previous);
      }
      setRuntimeError(
        "UPDATE FAILED — STATE ROLLED BACK (write access required)",
      );
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: RUNTIME_KEY });
    },
  });
  const [runtimeError, setRuntimeError] = useState<string | null>(null);

  const runtime = runtimeQuery.data ?? RUNTIME_FALLBACK;

  function setRuntime<K extends keyof RuntimeSettings>(
    key: K,
    value: RuntimeSettings[K],
  ) {
    setRuntimeError(null);
    runtimeMutation.mutate({ [key]: value });
  }

  // --- Kill switch: server-owned, not a localStorage preference ---
  const killSwitchQuery = useQuery<boolean>({
    queryFn: async () => {
      const res = await fetch("/api/risk/kill-switch");
      if (!res.ok) {
        throw new Error(`API ${res.status}`);
      }
      return ((await res.json()) as { enabled: boolean }).enabled;
    },
    queryKey: ["risk", "kill-switch"],
    staleTime: 10_000,
  });
  const killSwitchMutation = useMutation({
    mutationFn: async (enabled: boolean) => {
      const key = getStoredApiKey();
      const res = await fetch("/api/risk/kill-switch", {
        body: JSON.stringify({ enabled }),
        headers: {
          "content-type": "application/json",
          ...(key ? { "x-api-key": key } : {}),
        },
        method: "POST",
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(`Kill switch update failed: ${res.status} ${detail}`);
      }
      return enabled;
    },
    // Optimistic: flip immediately, roll back on failure, reconcile.
    onMutate: async (enabled) => {
      await queryClient.cancelQueries({ queryKey: ["risk", "kill-switch"] });
      const previous = queryClient.getQueryData<boolean>([
        "risk",
        "kill-switch",
      ]);
      queryClient.setQueryData(["risk", "kill-switch"], enabled);
      return { previous };
    },
    onError: (_error, _enabled, context) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData(["risk", "kill-switch"], context.previous);
      }
      setKillSwitchError("UPDATE FAILED — STATE ROLLED BACK");
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["risk", "kill-switch"] });
    },
  });
  const [killSwitchError, setKillSwitchError] = useState<string | null>(null);

  return (
    <div className="flex h-full flex-col">
      {/* Header bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2 sm:px-4">
        <div className="flex items-center gap-2">
          <Settings className="h-3.5 w-3.5 text-terminal-green" />
          <h1 className="text-xs font-bold tracking-wider text-foreground">
            TERMINAL SETTINGS
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleReset}
            className="flex items-center gap-1.5 border border-border px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground hover:border-terminal-dim"
          >
            <RotateCcw className="h-3 w-3" />
            Reset Defaults
          </button>
          <button
            type="button"
            onClick={handleSave}
            className={`flex items-center gap-1.5 px-3 py-1 text-[10px] font-bold uppercase tracking-wider transition-colors ${
              saved
                ? "bg-terminal-green/20 border border-terminal-green/40 text-terminal-green"
                : "bg-terminal-green text-primary-foreground hover:bg-terminal-green/80"
            }`}
          >
            {saved ? (
              <>
                <Check className="h-3 w-3" />
                Saved
              </>
            ) : (
              "Save Config"
            )}
          </button>
        </div>
      </div>
      <ScrollArea className="flex-1">
        <div className="grid grid-cols-1 gap-px p-px md:grid-cols-2">
          {/* Column 1 */}
          <div className="flex flex-col gap-px">
            {/* Broker Accounts */}
            <SettingsSection
              icon={Wallet}
              title="BROKER ACCOUNTS"
              description="Server-side broker status and paper/live execution mode"
            >
              <BrokerAccountsSection />
            </SettingsSection>

            {/* Terminal Color Scheme */}
            <SettingsSection
              icon={Palette}
              title="TERMINAL COLOR SCHEME"
              description="Choose the accent palette for the entire terminal"
            >
              <ColorSchemeSelect
                value={colorScheme}
                onChange={(v) => setColorScheme(v as ColorSchemeId)}
              />
            </SettingsSection>

            {/* Display & Interface */}
            <SettingsSection
              icon={Monitor}
              title="DISPLAY & INTERFACE"
              description="Visual preferences and terminal behavior (this device)"
            >
              <InlineSelect
                label="TIMEZONE"
                description="All timestamps are displayed in this timezone"
                value={settings.timezone}
                options={["UTC", "EST", "CST", "PST", "CET", "JST", "AEST"]}
                onChange={(v) => set("timezone", v)}
              />
              <InlineSelect
                label="BASE CURRENCY"
                description="Denomination for portfolio and P&L values"
                value={settings.baseCurrency}
                options={["USD", "EUR", "GBP", "JPY", "BTC", "ETH"]}
                onChange={(v) => set("baseCurrency", v)}
              />
              <ToggleRow
                label="COMPACT MODE"
                description="Reduce padding and show more data on screen"
                value={settings.compactMode}
                onChange={(v) => set("compactMode", v)}
              />
              <ToggleRow
                label="ANIMATIONS"
                description="Flash and slide transitions for live values"
                value={settings.animationsEnabled}
                onChange={(v) => set("animationsEnabled", v)}
              />
              <ToggleRow
                label="TICKER BAR"
                description="Show scrolling price ticker at top of terminal"
                value={settings.tickerBarEnabled}
                onChange={(v) => set("tickerBarEnabled", v)}
              />
              <ToggleRow
                label="SOUND EFFECTS"
                description="Play audio cues for trades and alerts"
                value={settings.soundEnabled}
                onChange={(v) => set("soundEnabled", v)}
              />
            </SettingsSection>

            {/* Risk Management */}
            <SettingsSection
              icon={Shield}
              title="RISK MANAGEMENT"
              description="Server-enforced limits — gated by the risk engine on every proposal"
            >
              <div className="flex flex-col gap-1">
                <SliderRow
                  label="MAX DAILY LOSS"
                  description="Risk gate rejects proposals when today's realized loss exceeds this share of capital"
                  value={runtime.maxDailyLossPct}
                  min={1}
                  max={20}
                  suffix="%"
                  color="text-terminal-red"
                  onChange={(v) => setRuntime("maxDailyLossPct", v)}
                />
                {runtimeQuery.isError && (
                  <span className="text-[10px] text-terminal-red">
                    SERVER UNREACHABLE — showing defaults
                  </span>
                )}
                {runtimeError && (
                  <span className="text-[10px] font-bold text-terminal-red">
                    {runtimeError}
                  </span>
                )}
              </div>
              <SliderRow
                label="MAX OPEN POSITIONS"
                description="Risk gate rejects proposals that would exceed this many concurrent open positions"
                value={runtime.maxOpenPositions}
                min={1}
                max={50}
                color="text-terminal-amber"
                onChange={(v) => setRuntime("maxOpenPositions", v)}
              />
              <div className="flex items-center justify-between gap-4 border-t border-border pt-3">
                <div className="flex flex-col gap-0.5">
                  <div className="flex items-center gap-1.5">
                    <AlertTriangle className="h-3 w-3 text-terminal-red" />
                    <span className="text-xs font-bold text-terminal-red">
                      KILL SWITCH
                    </span>
                  </div>
                  <span className="text-[10px] text-muted-foreground">
                    Emergency halt: blocks all new order submission at the
                    server-side risk gate
                  </span>
                  {killSwitchError && (
                    <span className="text-[10px] font-bold text-terminal-red">
                      {killSwitchError}
                    </span>
                  )}
                </div>{" "}
                <button
                  type="button"
                  aria-label={
                    killSwitchQuery.data
                      ? "Disarm kill switch"
                      : "Arm kill switch"
                  }
                  disabled={
                    killSwitchQuery.isPending || killSwitchQuery.isLoading
                  }
                  onClick={() =>
                    killSwitchMutation.mutate(!killSwitchQuery.data)
                  }
                  className={`shrink-0 border px-3 py-1 text-[10px] font-bold uppercase tracking-wider transition-colors ${
                    killSwitchQuery.data
                      ? "border-terminal-red/40 bg-terminal-red/10 text-terminal-red"
                      : "border-border bg-secondary text-terminal-dim"
                  }`}
                >
                  {killSwitchQuery.isLoading
                    ? "…"
                    : killSwitchQuery.data
                      ? "ARMED"
                      : "DISARMED"}
                </button>
              </div>
            </SettingsSection>
          </div>

          {/* Column 2 */}
          <div className="flex flex-col gap-px">
            {/* Notifications */}
            <SettingsSection
              icon={Bell}
              title="NOTIFICATIONS"
              description="Alert preferences and thresholds (this device)"
            >
              <ToggleRow
                label="TRADE EXECUTION ALERTS"
                description="Notify when positions are opened or closed"
                value={settings.tradeAlerts}
                onChange={(v) => set("tradeAlerts", v)}
              />
              <ToggleRow
                label="SIGNAL ALERTS"
                description="Notify when signals meet entry threshold"
                value={settings.signalAlerts}
                onChange={(v) => set("signalAlerts", v)}
              />
              <ToggleRow
                label="RISK ALERTS"
                description="Notify on drawdown warnings and limit breaches"
                value={settings.riskAlerts}
                onChange={(v) => set("riskAlerts", v)}
              />
              <ToggleRow
                label="AGENT STATUS ALERTS"
                description="Notify when agents go offline or encounter errors"
                value={settings.agentStatusAlerts}
                onChange={(v) => set("agentStatusAlerts", v)}
              />
              <ToggleRow
                label="CONSENSUS ALERTS"
                description="Notify when the swarm reaches consensus on a proposal"
                value={settings.consensusAlerts}
                onChange={(v) => set("consensusAlerts", v)}
              />
              <SliderRow
                label="ALERT SCORE THRESHOLD"
                description="Minimum signal score to trigger notifications"
                value={settings.alertThreshold}
                min={10}
                max={100}
                color="text-terminal-amber"
                onChange={(v) => set("alertThreshold", v)}
              />
            </SettingsSection>

            {/* Agent Configuration */}
            <SettingsSection
              icon={Cpu}
              title="AGENT CONFIGURATION"
              description="Pipeline-wide parameters enforced by the coordination layer"
            >
              <InlineSelect
                label="DEFAULT LLM PROVIDER"
                description="Pre-selected provider when creating new strategies"
                value={settings.defaultLlm}
                options={["OPENAI", "ANTHROPIC", "GOOGLE", "XAI", "DEEPSEEK"]}
                onChange={(v) => set("defaultLlm", v)}
              />
              <SliderRow
                label="CONSENSUS QUORUM"
                description="Approval percentage the COORDINATION step requires before executing a proposal"
                value={runtime.consensusQuorum}
                min={30}
                max={100}
                suffix="%"
                color="text-terminal-green"
                onChange={(v) => setRuntime("consensusQuorum", v)}
              />
              <SliderRow
                label="HEARTBEAT INTERVAL"
                description="Agents are shown offline after 3 missed heartbeats (interval × 3)"
                value={runtime.heartbeatInterval}
                min={5}
                max={120}
                suffix="s"
                color="text-terminal-cyan"
                onChange={(v) => setRuntime("heartbeatInterval", v)}
              />
              <ToggleRow
                label="DEBUG MODE"
                description="Live feed appends raw pipeline detail (rejection reasons, thresholds)"
                value={runtime.debugMode}
                onChange={(v) => setRuntime("debugMode", v)}
              />
            </SettingsSection>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}
