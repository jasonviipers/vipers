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
import { useState } from "react";
import { BrokerAccountsSection } from "@/components/settings/broker-accounts";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useColorScheme } from "@/context/color-scheme-context";
import {
  COLOR_SCHEMES,
  type ColorSchemeId,
} from "@/context/color-scheme-context-utils";
import { isDemoSession } from "@/lib/api-key";
import {
  DEFAULT_TERMINAL_SETTINGS,
  loadTerminalSettings,
  saveTerminalSettings,
  type TerminalSettings,
} from "@/lib/terminal-settings";

// -- Server-enforced runtime settings (runtime_settings DB row) --------------

interface RuntimeSettings {
  automationEnabled: boolean;
  automationIntervalSec: number;
  consensusQuorum: number;
  debugMode: boolean;
  defaultLlmProvider: string;
  heartbeatInterval: number;
  maxDailyLossPct: number;
  maxOpenPositions: number;
}

const RUNTIME_FALLBACK: RuntimeSettings = {
  automationEnabled: false,
  automationIntervalSec: 300,
  consensusQuorum: 50,
  debugMode: false,
  defaultLlmProvider: "OLLAMA",
  heartbeatInterval: 30,
  maxDailyLossPct: 3,
  maxOpenPositions: 10,
};

// ── LLM key management (GET/PUT/DELETE /api/llm/credentials) ───────────

interface LlmKeyStatus {
  hint: string | null;
  provider: string;
  source: "database" | "env" | null;
}

const LLM_PROVIDER_LABELS: Record<string, string> = {
  ANTHROPIC: "ANTHROPIC",
  DEEPSEEK: "DEEPSEEK",
  GOOGLE: "GOOGLE",
  OLLAMA: "OLLAMA (Cloud)",
  OPENAI: "OPENAI",
  XAI: "XAI",
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
        aria-label={label}
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

// ── LLM API key manager ─────────────────────────────────────────────────

function LlmKeyRowStatus({ status }: { status: LlmKeyStatus | undefined }) {
  const sourceLabel =
    status?.source === "database"
      ? "STORED"
      : status?.source === "env"
        ? "ENV"
        : "NOT SET";

  return (
    <span
      className={`text-[9px] font-bold tracking-wider ${
        status?.source ? "text-terminal-green" : "text-terminal-dim"
      }`}
    >
      {sourceLabel}
      {status?.hint ? ` ${status.hint}` : ""}
    </span>
  );
}

function LlmKeyRowAction({
  demoSession,
  editing,
  hasKey,
  onCancel,
  onStartEdit,
}: {
  demoSession: boolean;
  editing: boolean;
  hasKey: boolean;
  onCancel: () => void;
  onStartEdit: () => void;
}) {
  if (demoSession) {
    return (
      <span className="text-[9px] font-bold tracking-wider text-terminal-amber">
        READ-ONLY
      </span>
    );
  }
  if (editing) {
    return (
      <button
        type="button"
        onClick={onCancel}
        className="text-[9px] font-bold text-muted-foreground hover:text-foreground"
      >
        CANCEL
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onStartEdit}
      className="text-[9px] font-bold tracking-wider text-terminal-green hover:text-foreground"
    >
      {hasKey ? "UPDATE" : "ADD KEY"}
    </button>
  );
}

function LlmKeyRowHeader({
  provider,
  status,
  demoSession,
  editing,
  onCancel,
  onStartEdit,
}: {
  provider: string;
  status: LlmKeyStatus | undefined;
  demoSession: boolean;
  editing: boolean;
  onCancel: () => void;
  onStartEdit: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-xs font-bold text-foreground">{provider}</span>
      <div className="flex items-center gap-2">
        <LlmKeyRowStatus status={status} />
        <LlmKeyRowAction
          demoSession={demoSession}
          editing={editing}
          hasKey={Boolean(status?.source)}
          onCancel={onCancel}
          onStartEdit={onStartEdit}
        />
      </div>
    </div>
  );
}

function LlmKeyRowEditor({
  provider,
  status,
  keyValue,
  error,
  savePending,
  deletePending,
  onKeyValueChange,
  onSave,
  onDelete,
}: {
  provider: string;
  status: LlmKeyStatus | undefined;
  keyValue: string;
  error: string | null;
  savePending: boolean;
  deletePending: boolean;
  onKeyValueChange: (v: string) => void;
  onSave: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex gap-1.5">
        <input
          type="password"
          value={keyValue}
          placeholder={`${provider} API key`}
          onChange={(e) => onKeyValueChange(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          className="flex-1 border border-border bg-secondary px-2 py-1.5 text-xs text-foreground placeholder:text-terminal-dim focus:border-terminal-green/40 focus:outline-none"
        />
        <button
          type="button"
          disabled={savePending || keyValue.trim().length < 8}
          onClick={onSave}
          className="border border-terminal-green/40 bg-terminal-green/10 px-3 text-[10px] font-bold tracking-wider text-terminal-green hover:bg-terminal-green/20 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {savePending ? "…" : "SAVE"}
        </button>
      </div>
      {error && (
        <span className="text-[10px] font-bold text-terminal-red">{error}</span>
      )}
      {status?.source === "database" && (
        <button
          type="button"
          disabled={deletePending}
          onClick={onDelete}
          className="self-start text-[9px] font-bold tracking-wider text-terminal-red/80 hover:text-terminal-red"
        >
          REMOVE STORED KEY (FALL BACK TO ENV)
        </button>
      )}
    </div>
  );
}

function LlmKeyRow({
  provider,
  status,
}: {
  provider: string;
  status: LlmKeyStatus | undefined;
}) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [keyValue, setKeyValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const demoSession = isDemoSession();

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["llm", "credentials"] });
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/llm/credentials", {
        body: JSON.stringify({ apiKey: keyValue, provider }),
        headers: {
          "content-type": "application/json",
        },
        method: "PUT",
      });
      if (!res.ok) {
        throw new Error(`save failed (${res.status})`);
      }
    },
    onSuccess: () => {
      setEditing(false);
      setKeyValue("");
      setError(null);
      invalidate();
    },
    onError: (err) =>
      setError(
        err instanceof Error && err.message.includes("403")
          ? "FORBIDDEN — operator key required (demo is read-only)"
          : err instanceof Error
            ? err.message
            : "save failed",
      ),
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/llm/credentials?provider=${provider}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        throw new Error(`delete failed (${res.status})`);
      }
    },
    onSuccess: () => {
      setEditing(false);
      setError(null);
      invalidate();
    },
    onError: (err) =>
      setError(err instanceof Error ? err.message : "delete failed"),
  });

  return (
    <div className="flex flex-col gap-1 border-b border-border/50 pb-2 last:border-b-0">
      <LlmKeyRowHeader
        provider={provider}
        status={status}
        demoSession={demoSession}
        editing={editing}
        onCancel={() => {
          setEditing(false);
          setKeyValue("");
          setError(null);
        }}
        onStartEdit={() => setEditing(true)}
      />
      {editing && (
        <LlmKeyRowEditor
          provider={provider}
          status={status}
          keyValue={keyValue}
          error={error}
          savePending={saveMutation.isPending}
          deletePending={deleteMutation.isPending}
          onKeyValueChange={setKeyValue}
          onSave={() => saveMutation.mutate()}
          onDelete={() => deleteMutation.mutate()}
        />
      )}
    </div>
  );
}

interface AgentLlmConfig {
  agentId: string;
  codename: string;
  providerOverride: string | null;
  /** Per-agent model override within the provider's catalog; null = default. */
  modelOverride: string | null;
  team: string;
}

interface AgentModelPreset {
  agentId: string;
  model: string;
  rationale: string;
  provider: string;
}

function AgentLlmConfigSection({ fleetProvider }: { fleetProvider: string }) {
  const queryClient = useQueryClient();
  const AGENT_LLM_KEY = ["settings", "agent-llm"] as const;

  const { data, isError } = useQuery<{
    agents: AgentLlmConfig[];
    presets: AgentModelPreset[];
    providerModels: Record<string, string[]>;
  }>({
    queryKey: AGENT_LLM_KEY,
    queryFn: async () => {
      const res = await fetch("/api/settings/agent-llm");
      if (!res.ok) throw new Error(`API ${res.status}`);
      return (await res.json()) as {
        agents: AgentLlmConfig[];
        presets: AgentModelPreset[];
        providerModels: Record<string, string[]>;
      };
    },
    staleTime: 10_000,
  });

  const updateMutation = useMutation({
    mutationFn: async (payload: {
      agentId: string;
      provider: string | null;
      model?: string | null;
    }) => {
      const res = await fetch("/api/settings/agent-llm", {
        body: JSON.stringify(payload),
        headers: { "content-type": "application/json" },
        method: "PUT",
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(`${res.status} ${detail}`);
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: AGENT_LLM_KEY }),
  });

  const agents = data?.agents ?? [];
  const providerModels = data?.providerModels ?? {};
  const presets = new Map(
    (data?.presets ?? []).map((preset) => [preset.agentId, preset]),
  );
  if (agents.length === 0 && !isError) {
    return null;
  }

  return (
    <div className="border-t border-border pt-3 flex flex-col gap-2">
      <span className="text-[10px] text-muted-foreground">
        Each agent runs its own recommended Ollama Cloud model out of the box
        (shown as RECOMMENDED). Pin an explicit provider/model to override the
        recommendation, or pick FLEET DEFAULT to follow the fleet provider
        above. Keys resolve from stored keys first, then env.
      </span>
      {isError && (
        <span className="text-[10px] text-terminal-red">
          AGENT CONFIG UNREACHABLE
        </span>
      )}
      {agents.map((agent) => {
        const preset = presets.get(agent.agentId);
        const isOverridden = agent.providerOverride != null;
        const currentOption = isOverridden
          ? (agent.providerOverride as string)
          : preset
            ? `RECOMMENDED (${preset.provider})`
            : `FLEET DEFAULT (${fleetProvider})`;
        const effectiveProvider = agent.providerOverride ?? fleetProvider;
        const modelOptions = providerModels[effectiveProvider] ?? [];
        // Show a model picker when the effective provider has a real catalog
        // (Ollama today); single-model providers render their default only.
        const showModelPicker = modelOptions.length > 1;
        const currentModelOption = agent.modelOverride ?? "PROVIDER DEFAULT";
        return (
          <div key={agent.agentId} className="flex flex-col gap-0.5">
            <span className="text-[9px] font-bold tracking-wider text-terminal-dim">
              {agent.codename} — {agent.team}
            </span>
            <InlineSelect
              label={agent.agentId}
              value={currentOption}
              options={[
                `RECOMMENDED (${preset?.provider ?? "OLLAMA"})`,
                `FLEET DEFAULT (${fleetProvider})`,
                "OPENAI",
                "ANTHROPIC",
                "GOOGLE",
                "XAI",
                "DEEPSEEK",
                "OLLAMA",
              ]}
              onChange={(v) => {
                // RECOMMENDED clears the override row: resolution falls back
                // to the agent's preset (its own model out of the box).
                const isRecommended = v.startsWith("RECOMMENDED");
                const isFleet = v.startsWith("FLEET DEFAULT");
                const nextProvider = isRecommended || isFleet ? null : v;
                const nextCatalog = nextProvider
                  ? (providerModels[nextProvider] ?? [])
                  : [];
                updateMutation.mutate({
                  agentId: agent.agentId,
                  provider: nextProvider,
                  // A provider switch drops a stale model override that isn't
                  // in the new provider's catalog.
                  model:
                    agent.modelOverride &&
                    nextCatalog.includes(agent.modelOverride)
                      ? agent.modelOverride
                      : null,
                });
              }}
            />
            <span className="text-[9px] text-muted-foreground">
              {isOverridden
                ? `PINNED → ${agent.providerOverride}${agent.modelOverride ? ` / ${agent.modelOverride}` : ""}`
                : preset
                  ? `${preset.model} — ${preset.rationale}`
                  : `fleet default — ${fleetProvider}`}
            </span>
            {isOverridden && showModelPicker && (
              <InlineSelect
                label={`${agent.agentId} MODEL`}
                value={currentModelOption}
                options={["PROVIDER DEFAULT", ...modelOptions]}
                onChange={(v) =>
                  updateMutation.mutate({
                    agentId: agent.agentId,
                    provider: agent.providerOverride ?? fleetProvider,
                    model: v === "PROVIDER DEFAULT" ? null : v,
                  })
                }
              />
            )}
          </div>
        );
      })}
      {updateMutation.isPending && (
        <span className="text-[10px] font-bold text-terminal-cyan">
          SAVING AGENT LLM CONFIG…
        </span>
      )}
    </div>
  );
}

function LlmCredentialsSection() {
  const { data, isError } = useQuery<LlmKeyStatus[]>({
    queryKey: ["llm", "credentials"],
    queryFn: async () => {
      const res = await fetch("/api/llm/credentials");
      if (!res.ok) {
        throw new Error(`API ${res.status}`);
      }
      const payload = (await res.json()) as {
        providers: LlmKeyStatus[];
      };
      return payload.providers;
    },
    staleTime: 10_000,
  });

  return (
    <div className="flex flex-col gap-2">
      <span className="text-[10px] text-muted-foreground">
        API keys are encrypted (AES-256-GCM) on the server. The DEFAULT LLM
        PROVIDER below resolves its key here first, then env vars.
      </span>
      {isError ? (
        <span className="text-[10px] text-terminal-red">
          KEY STATUS UNAVAILABLE — server unreachable
        </span>
      ) : (
        Object.keys(LLM_PROVIDER_LABELS).map((provider) => (
          <LlmKeyRow
            key={provider}
            provider={provider}
            status={data?.find((s) => s.provider === provider)}
          />
        ))
      )}
    </div>
  );
}

// ── Settings surface composition ─────────────────────────────────────────

type SettingsSetter = <K extends keyof TerminalSettings>(
  key: K,
  value: TerminalSettings[K],
) => void;

type RuntimeSetter = <K extends keyof RuntimeSettings>(
  key: K,
  value: RuntimeSettings[K],
) => void;

function DisplayInterfaceSection({
  settings,
  onChange,
}: {
  settings: TerminalSettings;
  onChange: SettingsSetter;
}) {
  return (
    <>
      <InlineSelect
        label="TIMEZONE"
        description="All timestamps are displayed in this timezone"
        value={settings.timezone}
        options={["UTC", "EST", "CST", "PST", "CET", "JST", "AEST"]}
        onChange={(v) => onChange("timezone", v)}
      />
      <InlineSelect
        label="BASE CURRENCY"
        description="Denomination for portfolio and P&L values"
        value={settings.baseCurrency}
        options={["USD", "EUR", "GBP", "JPY", "BTC", "ETH"]}
        onChange={(v) => onChange("baseCurrency", v)}
      />
      <ToggleRow
        label="COMPACT MODE"
        description="Reduce padding and show more data on screen"
        value={settings.compactMode}
        onChange={(v) => onChange("compactMode", v)}
      />
      <ToggleRow
        label="ANIMATIONS"
        description="Flash and slide transitions for live values"
        value={settings.animationsEnabled}
        onChange={(v) => onChange("animationsEnabled", v)}
      />
      <ToggleRow
        label="TICKER BAR"
        description="Show scrolling price ticker at top of terminal"
        value={settings.tickerBarEnabled}
        onChange={(v) => onChange("tickerBarEnabled", v)}
      />
      <ToggleRow
        label="SOUND EFFECTS"
        description="Play audio cues for trades and alerts"
        value={settings.soundEnabled}
        onChange={(v) => onChange("soundEnabled", v)}
      />
    </>
  );
}

function NotificationsSection({
  settings,
  onChange,
}: {
  settings: TerminalSettings;
  onChange: SettingsSetter;
}) {
  return (
    <>
      <ToggleRow
        label="TRADE EXECUTION ALERTS"
        description="Notify when positions are opened or closed"
        value={settings.tradeAlerts}
        onChange={(v) => onChange("tradeAlerts", v)}
      />
      <ToggleRow
        label="SIGNAL ALERTS"
        description="Notify when signals meet entry threshold"
        value={settings.signalAlerts}
        onChange={(v) => onChange("signalAlerts", v)}
      />
      <ToggleRow
        label="RISK ALERTS"
        description="Notify on drawdown warnings and limit breaches"
        value={settings.riskAlerts}
        onChange={(v) => onChange("riskAlerts", v)}
      />
      <ToggleRow
        label="AGENT STATUS ALERTS"
        description="Notify when agents go offline or encounter errors"
        value={settings.agentStatusAlerts}
        onChange={(v) => onChange("agentStatusAlerts", v)}
      />
      <ToggleRow
        label="CONSENSUS ALERTS"
        description="Notify when the swarm reaches consensus on a proposal"
        value={settings.consensusAlerts}
        onChange={(v) => onChange("consensusAlerts", v)}
      />
      <SliderRow
        label="ALERT SCORE THRESHOLD"
        description="Minimum signal score to trigger notifications"
        value={settings.alertThreshold}
        min={10}
        max={100}
        color="text-terminal-amber"
        onChange={(v) => onChange("alertThreshold", v)}
      />
    </>
  );
}

function KillSwitchRow({
  enabled,
  isLoading,
  disabled,
  error,
  onToggle,
}: {
  enabled: boolean;
  isLoading: boolean;
  disabled: boolean;
  error: string | null;
  onToggle: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-t border-border pt-3">
      <div className="flex flex-col gap-0.5">
        <div className="flex items-center gap-1.5">
          <AlertTriangle className="h-3 w-3 text-terminal-red" />
          <span className="text-xs font-bold text-terminal-red">
            KILL SWITCH
          </span>
        </div>
        <span className="text-[10px] text-muted-foreground">
          Emergency halt: blocks all new order submission at the server-side
          risk gate
        </span>
        {error && (
          <span className="text-[10px] font-bold text-terminal-red">
            {error}
          </span>
        )}
      </div>{" "}
      <button
        type="button"
        aria-label={enabled ? "Disarm kill switch" : "Arm kill switch"}
        disabled={disabled}
        onClick={onToggle}
        className={`shrink-0 border px-3 py-1 text-[10px] font-bold uppercase tracking-wider transition-colors ${
          enabled
            ? "border-terminal-red/40 bg-terminal-red/10 text-terminal-red"
            : "border-border bg-secondary text-terminal-dim"
        }`}
      >
        {isLoading ? "…" : enabled ? "ARMED" : "DISARMED"}
      </button>
    </div>
  );
}

function RiskManagementSection({
  runtime,
  serverUnreachable,
  error,
  onChange,
  killSwitchEnabled,
  killSwitchIsLoading,
  killSwitchDisabled,
  killSwitchError,
  onToggleKillSwitch,
}: {
  runtime: RuntimeSettings;
  serverUnreachable: boolean;
  error: string | null;
  onChange: RuntimeSetter;
  killSwitchEnabled: boolean;
  killSwitchIsLoading: boolean;
  killSwitchDisabled: boolean;
  killSwitchError: string | null;
  onToggleKillSwitch: () => void;
}) {
  return (
    <>
      <div className="flex flex-col gap-1">
        <SliderRow
          label="MAX DAILY LOSS"
          description="Risk gate rejects proposals when today's realized loss exceeds this share of capital"
          value={runtime.maxDailyLossPct}
          min={1}
          max={20}
          suffix="%"
          color="text-terminal-red"
          onChange={(v) => onChange("maxDailyLossPct", v)}
        />
        {serverUnreachable && (
          <span className="text-[10px] text-terminal-red">
            SERVER UNREACHABLE — showing defaults
          </span>
        )}
        {error && (
          <span className="text-[10px] font-bold text-terminal-red">
            {error}
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
        onChange={(v) => onChange("maxOpenPositions", v)}
      />
      <KillSwitchRow
        enabled={killSwitchEnabled}
        isLoading={killSwitchIsLoading}
        disabled={killSwitchDisabled}
        error={killSwitchError}
        onToggle={onToggleKillSwitch}
      />
    </>
  );
}

function AgentAutomationSection({
  enabled,
  interval,
  isSaving,
  error,
  onChange,
}: {
  enabled: boolean;
  interval: number;
  isSaving: boolean;
  error: string | null;
  onChange: RuntimeSetter;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col gap-0.5">
          <span className="text-xs font-bold text-foreground">
            ENABLE AGENT AUTOMATION
          </span>
          <span className="text-[10px] text-muted-foreground">
            Runs signal → analysis → consensus → risk → execution automatically.
            The kill switch and risk caps still gate every order.
          </span>
          {error && (
            <span className="text-[10px] font-bold text-terminal-red">
              {error}
            </span>
          )}
        </div>
        <button
          type="button"
          aria-label={
            enabled ? "Disable agent automation" : "Enable agent automation"
          }
          aria-pressed={enabled}
          disabled={isSaving}
          onClick={() => onChange("automationEnabled", !enabled)}
          className={`shrink-0 border px-3 py-1 text-[10px] font-bold uppercase tracking-wider transition-colors ${
            enabled
              ? "border-terminal-green/40 bg-terminal-green/10 text-terminal-green"
              : "border-border bg-secondary text-terminal-dim"
          }`}
        >
          {enabled ? "ENABLED" : "DISABLED"}
        </button>
      </div>
      {isSaving && (
        <span className="text-[10px] font-bold text-terminal-cyan">
          SAVING AUTOMATION STATE…
        </span>
      )}
      <div className="border-t border-border pt-2">
        <SliderRow
          label="AUTOMATION INTERVAL"
          description="Time between automatic pipeline passes; each pass analyzes one asset in rotation (BTC → ETH → SOL → XRP → DOGE)"
          value={interval}
          min={60}
          max={3600}
          suffix="s"
          color="text-terminal-cyan"
          onChange={(v) => onChange("automationIntervalSec", v)}
        />
      </div>
    </div>
  );
}

function AgentConfigurationSection({
  runtime,
  serverUnreachable,
  onChange,
}: {
  runtime: RuntimeSettings;
  serverUnreachable: boolean;
  onChange: RuntimeSetter;
}) {
  return (
    <>
      <InlineSelect
        label="DEFAULT LLM PROVIDER"
        description="Fallback for agents with no override and no preset; each agent otherwise runs its own recommended Ollama model (see per-agent list below). Key resolved from the stored keys below, then env."
        value={runtime.defaultLlmProvider}
        options={["OPENAI", "ANTHROPIC", "GOOGLE", "XAI", "DEEPSEEK", "OLLAMA"]}
        onChange={(v) => onChange("defaultLlmProvider", v)}
      />
      {serverUnreachable && (
        <span className="text-[10px] text-terminal-red">
          SERVER UNREACHABLE — provider switching disabled
        </span>
      )}
      <AgentLlmConfigSection fleetProvider={runtime.defaultLlmProvider} />
      <LlmCredentialsSection />
      <SliderRow
        label="CONSENSUS QUORUM"
        description="Approval percentage the COORDINATION step requires before executing a proposal"
        value={runtime.consensusQuorum}
        min={30}
        max={100}
        suffix="%"
        color="text-terminal-green"
        onChange={(v) => onChange("consensusQuorum", v)}
      />
      <SliderRow
        label="HEARTBEAT INTERVAL"
        description="Agents are shown offline after 3 missed heartbeats (interval × 3)"
        value={runtime.heartbeatInterval}
        min={5}
        max={120}
        suffix="s"
        color="text-terminal-cyan"
        onChange={(v) => onChange("heartbeatInterval", v)}
      />
      <ToggleRow
        label="DEBUG MODE"
        description="Live feed appends raw pipeline detail (rejection reasons, thresholds)"
        value={runtime.debugMode}
        onChange={(v) => onChange("debugMode", v)}
      />
    </>
  );
}

export function SettingsView() {
  const { scheme: colorScheme, setScheme: setColorScheme } = useColorScheme();
  const [settings, setSettings] = useState<TerminalSettings>(() =>
    loadTerminalSettings(),
  );
  const [saved, setSaved] = useState(false);

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
      const res = await fetch("/api/settings/runtime", {
        body: JSON.stringify(patch),
        headers: {
          "content-type": "application/json",
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
    onSuccess: (savedSettings) => {
      // Reconcile the optimistic toggle with the authoritative server response
      // immediately; the invalidate below also refreshes other open clients.
      queryClient.setQueryData(RUNTIME_KEY, savedSettings);
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
      const res = await fetch("/api/risk/kill-switch", {
        body: JSON.stringify({ enabled }),
        headers: {
          "content-type": "application/json",
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
              <DisplayInterfaceSection settings={settings} onChange={set} />
            </SettingsSection>

            {/* Risk Management */}
            <SettingsSection
              icon={Shield}
              title="RISK MANAGEMENT"
              description="Server-enforced limits — gated by the risk engine on every proposal"
            >
              <RiskManagementSection
                runtime={runtime}
                serverUnreachable={runtimeQuery.isError}
                error={runtimeError}
                onChange={setRuntime}
                killSwitchEnabled={killSwitchQuery.data ?? false}
                killSwitchIsLoading={killSwitchQuery.isLoading}
                killSwitchDisabled={
                  killSwitchQuery.isPending || killSwitchQuery.isLoading
                }
                killSwitchError={killSwitchError}
                onToggleKillSwitch={() =>
                  killSwitchMutation.mutate(!(killSwitchQuery.data ?? false))
                }
              />
            </SettingsSection>

            {/* Agent Automation */}
            <SettingsSection
              icon={Cpu}
              title="AGENT AUTOMATION"
              description="Server-enforced autonomous loop — the swarm runs the full pipeline on a schedule"
            >
              <AgentAutomationSection
                enabled={runtime.automationEnabled}
                interval={runtime.automationIntervalSec}
                isSaving={runtimeMutation.isPending}
                error={runtimeError}
                onChange={setRuntime}
              />
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
              <NotificationsSection settings={settings} onChange={set} />
            </SettingsSection>

            {/* Agent Configuration */}
            <SettingsSection
              icon={Cpu}
              title="AGENT CONFIGURATION"
              description="Pipeline-wide parameters enforced by the coordination layer"
            >
              <AgentConfigurationSection
                runtime={runtime}
                serverUnreachable={runtimeQuery.isError}
                onChange={setRuntime}
              />
            </SettingsSection>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}
