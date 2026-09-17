"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  CircleSlash,
  KeyRound,
  Loader2,
  Lock,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Wallet,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  type BrokerAccount,
  type BrokerStatus,
  useBroker,
} from "@/context/broker-context";
import { isDemoSession } from "@/lib/api-key";

function BrokerStatusBadge({ status }: { status: BrokerStatus }) {
  const styles: Record<BrokerStatus, string> = {
    connected:
      "border-terminal-green/40 bg-terminal-green/10 text-terminal-green",
    disconnected: "border-border bg-secondary text-terminal-dim",
    pending:
      "border-terminal-amber/40 bg-terminal-amber/10 text-terminal-amber",
    error: "border-terminal-red/40 bg-terminal-red/10 text-terminal-red",
  };

  const labels: Record<BrokerStatus, string> = {
    connected: "CONNECTED",
    disconnected: "NOT CONFIGURED",
    pending: "CHECKING",
    error: "ERROR",
  };

  return (
    <span
      className={`inline-flex items-center gap-1 border px-2 py-0.5 text-[10px] font-bold tracking-wider ${styles[status]}`}
    >
      {status === "connected" && (
        <span className="h-1.5 w-1.5 bg-terminal-green animate-pulse" />
      )}
      {status === "pending" && <Loader2 className="h-2.5 w-2.5 animate-spin" />}
      {labels[status]}
    </span>
  );
}

function AccountTypeTag({ type }: { type: BrokerAccount["accountType"] }) {
  const styles: Record<string, string> = {
    stocks: "text-terminal-cyan border-terminal-cyan/30",
    crypto: "text-terminal-amber border-terminal-amber/30",
    "multi-asset": "text-terminal-gold border-terminal-gold/30",
  };

  return (
    <span
      className={`border px-1.5 py-0.5 text-[9px] font-bold tracking-wider uppercase ${styles[type] ?? "text-muted-foreground border-border"}`}
    >
      {type}
    </span>
  );
}

// ── Credential form (server-side storage via /api/broker/credentials) ─────

function CredentialField({
  label,
  placeholder,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  type?: "text" | "password";
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[9px] font-bold tracking-wider text-muted-foreground">
        {label}
      </span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        autoComplete="off"
        spellCheck={false}
        className="border border-border bg-secondary px-2 py-1.5 text-xs text-foreground placeholder:text-terminal-dim focus:border-terminal-green/40 focus:outline-none"
      />
    </label>
  );
}

function OkxCredentialForm({ onSaved }: { onSaved: () => void }) {
  const queryClient = useQueryClient();
  const [apiKey, setApiKey] = useState("");
  const [secret, setSecret] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [mode, setMode] = useState<"demo" | "live">("demo");
  const [region, setRegion] = useState<"default" | "eea" | "us">("default");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/broker/credentials", {
        body: JSON.stringify({ apiKey, mode, passphrase, region, secret }),
        headers: {
          "content-type": "application/json",
        },
        method: "PUT",
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(`${res.status}: ${detail || "save failed"}`);
      }
      return true;
    },
    onSuccess: () => {
      setSaved(true);
      setError(null);
      // Refresh both the broker status and credential summary.
      queryClient.invalidateQueries({ queryKey: ["broker"] });
      onSaved();
    },
    onError: (err) => {
      setError(
        err instanceof Error && err.message.includes("403")
          ? "FORBIDDEN — operator key required (demo is read-only)"
          : err instanceof Error
            ? err.message
            : "save failed",
      );
    },
  });

  // The demo key is read-only server-side (403 on both OKX and LLM
  // credential writes); show why instead of letting the save fail with an
  // opaque error.
  if (isDemoSession()) {
    return (
      <div className="flex items-start gap-2 border border-terminal-amber/30 bg-terminal-amber/5 p-2.5">
        <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-terminal-amber" />
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] font-bold text-terminal-amber">
            DEMO MODE — READ ONLY
          </span>
          <span className="text-[9px] text-muted-foreground leading-relaxed">
            Credential management requires an operator API key. Disconnect and
            sign in with a real key (demo keys cannot store credentials or
            trigger trading).
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2.5">
      <CredentialField
        label="API KEY"
        placeholder="OKX API key"
        value={apiKey}
        onChange={setApiKey}
      />
      <CredentialField
        label="API SECRET"
        placeholder="OKX secret key"
        type="password"
        value={secret}
        onChange={setSecret}
      />
      <CredentialField
        label="PASSPHRASE"
        placeholder="Passphrase set when creating the key"
        type="password"
        value={passphrase}
        onChange={setPassphrase}
      />
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-[9px] font-bold tracking-wider text-muted-foreground">
            EXECUTION MODE
          </span>
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as "demo" | "live")}
            className="border border-border bg-secondary px-2 py-1.5 text-xs text-foreground focus:border-terminal-green/40 focus:outline-none"
          >
            <option value="demo">DEMO — paper endpoints</option>
            <option value="live">LIVE — real capital</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[9px] font-bold tracking-wider text-muted-foreground">
            REGION
          </span>
          <select
            value={region}
            onChange={(e) =>
              setRegion(e.target.value as "default" | "eea" | "us")
            }
            disabled={mode === "demo"}
            className="border border-border bg-secondary px-2 py-1.5 text-xs text-foreground disabled:opacity-50 focus:border-terminal-green/40 focus:outline-none"
          >
            <option value="default">Default (global)</option>
            <option value="eea">EEA</option>
            <option value="us">US / AU</option>
          </select>
        </label>
      </div>

      {error && (
        <span className="text-[10px] font-bold text-terminal-red">{error}</span>
      )}

      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={
            saveMutation.isPending ||
            apiKey.trim().length < 16 ||
            secret.trim().length < 16 ||
            passphrase.trim().length === 0
          }
          onClick={() => saveMutation.mutate()}
          className="flex flex-1 items-center justify-center gap-2 bg-terminal-green py-2 text-[10px] font-bold tracking-wider text-primary-foreground transition-colors hover:bg-terminal-green/80 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {saveMutation.isPending ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <KeyRound className="h-3 w-3" />
          )}
          SAVE &amp; CONNECT
        </button>
        {saved && (
          <span className="flex items-center gap-1 text-[10px] font-bold text-terminal-green">
            <Check className="h-3 w-3" />
            SAVED
          </span>
        )}
      </div>
    </div>
  );
}

function DeleteCredentialsButton({ onDeleted }: { onDeleted: () => void }) {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const deleteMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/broker/credentials", {
        method: "DELETE",
      });
      if (!res.ok) {
        throw new Error(`${res.status}: delete failed`);
      }
      return true;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["broker"] });
      onDeleted();
    },
  });

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="flex items-center justify-center gap-1.5 border border-border bg-secondary py-1.5 text-[10px] font-bold tracking-wider text-muted-foreground transition-colors hover:border-terminal-red/40 hover:text-terminal-red"
      >
        <Trash2 className="h-3 w-3" />
        REMOVE CREDENTIALS
      </button>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        disabled={deleteMutation.isPending}
        onClick={() => deleteMutation.mutate()}
        className="flex-1 border border-terminal-red/40 bg-terminal-red/10 py-1.5 text-[10px] font-bold tracking-wider text-terminal-red hover:bg-terminal-red/20"
      >
        CONFIRM REMOVE
      </button>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        className="flex-1 border border-border bg-secondary py-1.5 text-[10px] font-bold tracking-wider text-muted-foreground hover:text-foreground"
      >
        CANCEL
      </button>
    </div>
  );
}

// ── Balance sync (ledger reconciliation with the live OKX equity) ────────

interface BrokerBalanceInfo {
  equityUsd: number;
  mode: "demo" | "live";
  updatedAt: string;
}

interface BalanceSyncResult {
  baseCapital: number;
  delta: number;
  equityUsd: number;
  mode: "demo" | "live";
  totalCapital: number;
}

/**
 * Reads the live OKX equity (GET) and reconciles the capital ledger with
 * it (POST). The dashboard's TOTAL CAPITAL is derived from the ledger, so
 * without this sync a freshly connected broker shows 0 forever.
 *
 * Gated on the auth probe: while credentials fail OKX authentication the
 * OKX call can only fail, so the row stays dormant (no failed requests on
 * mount) and activates/reloads automatically once auth flips healthy —
 * e.g. right after an environment-mismatch mode switch.
 */
function BalanceSyncRow() {
  const queryClient = useQueryClient();
  const { serverStatus } = useBroker();
  const authHealthy = serverStatus?.auth?.healthy === true;
  const [balance, setBalance] = useState<BrokerBalanceInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BalanceSyncResult | null>(null);

  const loadBalance = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/broker/balance");
      const payload = (await res.json().catch(() => null)) as
        | (BrokerBalanceInfo & { error?: string })
        | null;
      if (!res.ok || !payload) {
        throw new Error(
          payload?.error ?? `balance lookup failed (${res.status})`,
        );
      }
      setBalance({
        equityUsd: payload.equityUsd,
        mode: payload.mode,
        updatedAt: payload.updatedAt,
      });
    } catch (err) {
      setBalance(null);
      setError(err instanceof Error ? err.message : "balance lookup failed");
    }
  }, []);

  useEffect(() => {
    if (authHealthy) {
      void loadBalance();
    }
    // Reload when auth flips healthy (mode switch / credential re-save);
    // the equity read is an authenticated OKX call, so no polling.
  }, [authHealthy, loadBalance]);

  const syncMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/broker/balance", {
        method: "POST",
      });
      const payload = (await res.json().catch(() => null)) as
        | (BalanceSyncResult & { error?: string })
        | null;
      if (!res.ok) {
        throw new Error(payload?.error ?? `sync failed (${res.status})`);
      }
      return payload as BalanceSyncResult;
    },
    onSuccess: (data) => {
      setResult(data);
      setError(null);
      // TOTAL CAPITAL reads /api/status; refresh it plus the broker truth.
      void queryClient.invalidateQueries({ queryKey: ["status"] });
      void queryClient.invalidateQueries({ queryKey: ["broker"] });
    },
    onError: (err) =>
      setError(
        err instanceof Error && err.message.includes("403")
          ? "FORBIDDEN — operator key required (demo is read-only)"
          : err instanceof Error
            ? err.message
            : "sync failed",
      ),
  });

  // Dormant while auth is broken: the OKX call can only fail, so show why
  // instead of a dead button plus console noise.
  if (!authHealthy) {
    return (
      <div className="flex flex-col gap-1 border-t border-border pt-2">
        <span className="text-[9px] font-bold tracking-wider text-muted-foreground">
          BROKER EQUITY (USDT)
        </span>
        <span className="text-[9px] text-muted-foreground leading-relaxed">
          {serverStatus?.auth?.okxCode
            ? "Unavailable — fix authentication first (see the warning above)."
            : "Unavailable — checking OKX authentication…"}
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5 border-t border-border pt-2">
      <div className="flex items-center justify-between">
        <span className="text-[9px] font-bold tracking-wider text-muted-foreground">
          BROKER EQUITY (USDT)
        </span>
        <span className="text-[10px] font-bold text-foreground">
          {balance
            ? balance.equityUsd.toLocaleString("en-US", {
                maximumFractionDigits: 2,
              })
            : "—"}
        </span>
      </div>
      {error && (
        <span className="text-[9px] font-bold text-terminal-red">{error}</span>
      )}
      {result && (
        <span
          className={`text-[9px] font-bold ${
            result.delta === 0 ? "text-terminal-green" : "text-terminal-cyan"
          }`}
        >
          {result.delta === 0
            ? "LEDGER ALREADY IN SYNC"
            : `SYNCED ${result.delta > 0 ? "+" : ""}${result.delta.toFixed(2)} USDT — TOTAL CAPITAL ${result.totalCapital.toLocaleString(
                "en-US",
                {
                  maximumFractionDigits: 2,
                },
              )}`}
        </span>
      )}
      <button
        type="button"
        disabled={syncMutation.isPending}
        onClick={() => syncMutation.mutate()}
        className="flex items-center justify-center gap-2 border border-terminal-green/40 bg-terminal-green/10 py-1.5 text-[10px] font-bold tracking-wider text-terminal-green transition-colors hover:bg-terminal-green/20 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {syncMutation.isPending ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <RefreshCw className="h-3 w-3" />
        )}
        SYNC BALANCE TO CAPITAL
      </button>
    </div>
  );
}

// ── Config panel ──────────────────────────────────────────────────────────

/**
 * Broker configuration panel.
 *
 * Connection state is SERVER-OWNED: OKX is connected when the operator has
 * saved credentials through this panel (stored server-side, encrypted at
 * rest in the broker_credentials table). Plaintext never reaches the
 * browser again after submission — only masked hints.
 */
/**
 * One-click EXECUTION MODE switch that keeps the stored secrets. OKX's
 * 50101 (key/environment mismatch) is fixed either by switching mode or by
 * re-creating the key — but re-typing all three secrets just to flip mode
 * is unnecessary friction, and the server never returns them.
 *
 * Switching TO live asks for confirmation: that routes orders to real
 * capital.
 */
function ModeSwitchButton({ current }: { current: "live" | "paper" }) {
  const queryClient = useQueryClient();
  const demoSession = isDemoSession();
  const [confirmingLive, setConfirmingLive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const switchMutation = useMutation({
    mutationFn: async (mode: "demo" | "live") => {
      const res = await fetch("/api/broker/credentials", {
        body: JSON.stringify({ mode }),
        headers: {
          "content-type": "application/json",
        },
        method: "PATCH",
      });
      const payload = (await res.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (!res.ok) {
        throw new Error(payload?.error ?? `mode switch failed (${res.status})`);
      }
      return true;
    },
    onSuccess: () => {
      setError(null);
      setConfirmingLive(false);
      // Server-side health cache is invalidated by the PATCH; refetch so
      // the auth verdict and balance row react immediately.
      void queryClient.invalidateQueries({ queryKey: ["broker"] });
    },
    onError: (err) =>
      setError(
        err instanceof Error && err.message.includes("403")
          ? "FORBIDDEN — operator key required (demo is read-only)"
          : err instanceof Error
            ? err.message
            : "mode switch failed",
      ),
  });

  if (demoSession) {
    return (
      <span className="text-[9px] font-bold text-terminal-amber">
        {current === "live" ? "LIVE — REAL CAPITAL" : "DEMO — PAPER ENDPOINTS"}
      </span>
    );
  }

  const targetMode: "demo" | "live" = current === "live" ? "demo" : "live";

  return (
    <span className="flex items-center gap-2">
      {error && (
        <span className="text-[9px] font-bold text-terminal-red">{error}</span>
      )}
      {confirmingLive ? (
        <>
          <span className="text-[9px] font-bold text-terminal-red">
            REAL CAPITAL?
          </span>
          <button
            type="button"
            disabled={switchMutation.isPending}
            onClick={() => switchMutation.mutate("live")}
            className="border border-terminal-red/40 bg-terminal-red/10 px-2 py-0.5 text-[9px] font-bold text-terminal-red hover:bg-terminal-red/20"
          >
            CONFIRM LIVE
          </button>
          <button
            type="button"
            onClick={() => setConfirmingLive(false)}
            className="text-[9px] font-bold text-muted-foreground hover:text-foreground"
          >
            CANCEL
          </button>
        </>
      ) : (
        <>
          <span
            className={`text-[9px] font-bold ${current === "live" ? "text-terminal-red" : "text-terminal-amber"}`}
          >
            {current === "live"
              ? "LIVE — REAL CAPITAL"
              : "DEMO — PAPER ENDPOINTS"}
          </span>
          <button
            type="button"
            disabled={switchMutation.isPending}
            onClick={() => {
              setError(null);
              if (targetMode === "live") {
                setConfirmingLive(true);
              } else {
                switchMutation.mutate("demo");
              }
            }}
            className="border border-border bg-secondary px-2 py-0.5 text-[9px] font-bold text-muted-foreground transition-colors hover:text-foreground"
          >
            {switchMutation.isPending
              ? "…"
              : targetMode === "live"
                ? "SWITCH TO LIVE"
                : "SWITCH TO DEMO"}
          </button>
        </>
      )}
    </span>
  );
}

function BrokerConfigPanel({
  broker,
  onClose,
}: {
  broker: BrokerAccount;
  onClose: () => void;
}) {
  const { serverStatus, connectionStatus, setTradingEnabled } = useBroker();
  const queryClient = useQueryClient();
  const status = connectionStatus(broker.id);
  const isOkx = broker.id === "okx";
  const isEnabled = broker.tradingEnabled;
  // When no credentials are stored yet, open straight into the form.
  const [showForm, setShowForm] = useState(!serverStatus?.credentials.apiKey);

  const refreshStatus = () => {
    queryClient.invalidateQueries({ queryKey: ["broker"] });
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold tracking-wider text-foreground">
            {broker.name}
          </span>
          <AccountTypeTag type={broker.accountType} />
        </div>
        <BrokerStatusBadge status={status} />
      </div>

      <p className="text-[10px] text-muted-foreground leading-relaxed">
        {broker.description}
      </p>

      {/* Routing explanation */}
      <div className="flex items-start gap-2 border border-terminal-cyan/20 bg-terminal-cyan/5 p-2.5">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-terminal-cyan" />
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] font-bold text-terminal-cyan">
            ENCRYPTED SERVER-SIDE STORAGE
          </span>
          <span className="text-[9px] text-muted-foreground leading-relaxed">
            Credentials are encrypted (AES-256-GCM) in the server database and
            never returned to the browser after submission. Demo mode routes
            through OKX paper endpoints; live mode trades real capital.
          </span>
        </div>
      </div>

      {/* OKX credential truth from the server */}
      {isOkx &&
        (serverStatus ? (
          <div className="flex flex-col gap-1.5 border border-border bg-secondary/50 p-2">
            <span className="text-[9px] font-bold tracking-wider text-muted-foreground">
              STORED CREDENTIALS
            </span>
            {(
              [
                ["API Key", serverStatus.credentials.apiKey],
                ["API Secret", serverStatus.credentials.secret],
                ["API Passphrase", serverStatus.credentials.passphrase],
              ] as const
            ).map(([label, set]) => (
              <div key={label} className="flex items-center justify-between">
                <span className="text-[10px] text-foreground">{label}</span>
                <span
                  className={`text-[9px] font-bold ${set ? "text-terminal-green" : "text-terminal-dim"}`}
                >
                  {set ? "CONFIGURED" : "NOT SET"}
                </span>
              </div>
            ))}
            <div className="mt-1 flex items-center justify-between border-t border-border pt-1.5">
              <span className="text-[10px] text-foreground">
                EXECUTION MODE
              </span>
              <ModeSwitchButton current={serverStatus.mode} />
            </div>
            {/* Active auth probe: stored ≠ working. A configured set that
                fails OKX authentication shows the exchange's error code plus
                the operator-facing fix instead of failing silently later. */}
            {serverStatus.auth && !serverStatus.auth.healthy && (
              <div className="mt-1 flex items-start gap-2 border border-terminal-red/30 bg-terminal-red/5 p-2">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-terminal-red" />
                <div className="flex flex-col gap-0.5">
                  <span className="text-[9px] font-bold text-terminal-red">
                    {serverStatus.auth.okxCode
                      ? `AUTH FAILED — OKX ${serverStatus.auth.okxCode}`
                      : "AUTH CHECK UNAVAILABLE"}
                  </span>
                  {serverStatus.auth.hint && (
                    <span className="text-[9px] text-muted-foreground leading-relaxed">
                      {serverStatus.auth.hint}
                    </span>
                  )}
                </div>
              </div>
            )}
            {serverStatus.auth?.healthy && (
              <span className="text-[9px] font-bold text-terminal-green">
                ✓ AUTHENTICATED WITH OKX
              </span>
            )}
            {!showForm && (
              <div className="mt-1 flex gap-2 border-t border-border pt-1.5">
                <button
                  type="button"
                  onClick={() => setShowForm(true)}
                  className="flex-1 border border-border bg-secondary py-1 text-[9px] font-bold tracking-wider text-muted-foreground transition-colors hover:text-foreground"
                >
                  UPDATE CREDENTIALS
                </button>
                <DeleteCredentialsButton
                  onDeleted={() => {
                    setShowForm(false);
                    onClose();
                  }}
                />
              </div>
            )}
            <BalanceSyncRow />
          </div>
        ) : (
          <div className="flex items-center gap-2 border border-border bg-secondary/50 p-2 text-[10px] text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            Checking server configuration…
          </div>
        ))}

      {/* Credential entry form */}
      {isOkx && showForm && (
        <OkxCredentialForm
          onSaved={() => {
            setShowForm(false);
            refreshStatus();
          }}
        />
      )}

      {/* Non-wired adapters stay honest */}
      {!isOkx && (
        <div className="flex items-start gap-2 border border-border bg-secondary/50 p-2.5">
          <CircleSlash className="mt-0.5 h-3.5 w-3.5 shrink-0 text-terminal-dim" />
          <span className="text-[9px] text-muted-foreground leading-relaxed">
            No broker adapter is wired for this entry yet. Equity symbols always
            execute on the paper book.
          </span>
        </div>
      )}

      {/* Operator toggle — the only client-controlled state */}
      <button
        type="button"
        disabled={status !== "connected"}
        onClick={() => setTradingEnabled(broker.id, !isEnabled)}
        className={`flex items-center justify-center gap-2 py-2 text-[10px] font-bold tracking-wider transition-colors ${
          status !== "connected"
            ? "cursor-not-allowed border border-border bg-secondary text-terminal-dim opacity-50"
            : isEnabled
              ? "border border-terminal-red/30 bg-terminal-red/5 text-terminal-red hover:bg-terminal-red/10"
              : "bg-terminal-green text-primary-foreground hover:bg-terminal-green/80"
        }`}
      >
        <KeyRound className="h-3 w-3" />
        {status !== "connected"
          ? "SAVE CREDENTIALS TO ENABLE"
          : isEnabled
            ? "DISABLE TRADING ON THIS BROKER"
            : "ENABLE TRADING ON THIS BROKER"}
      </button>

      {/* Close */}
      <button
        type="button"
        onClick={onClose}
        className="flex items-center justify-center border border-border bg-secondary py-1.5 text-[10px] font-bold tracking-wider text-muted-foreground hover:text-foreground transition-colors"
      >
        DONE
      </button>
    </div>
  );
}

export function ActiveBrokerSwitcher() {
  const { activeBroker, connectedBrokers, setActiveBroker } = useBroker();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  if (connectedBrokers.length === 0) return null;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-2 border px-2.5 py-1 text-xs transition-colors ${
          open
            ? "border-terminal-green/40 bg-terminal-green/10 text-terminal-green"
            : "border-border bg-secondary text-foreground hover:border-terminal-dim"
        }`}
      >
        <Wallet className="h-3 w-3 text-terminal-green" />
        <span className="text-[10px] font-bold tracking-wider">
          {activeBroker.shortName}
        </span>
        <ChevronDown
          className={`h-3 w-3 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 min-w-50 border border-border bg-card shadow-lg shadow-black/40">
          <div className="border-b border-border px-3 py-1.5">
            <span className="text-[10px] font-bold tracking-wider text-muted-foreground">
              SWITCH BROKER
            </span>
          </div>
          {connectedBrokers.map((b) => {
            const active = activeBroker?.id === b.id;
            return (
              <button
                type="button"
                key={b.id}
                onClick={() => {
                  setActiveBroker(b.id);
                  setOpen(false);
                }}
                className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left transition-colors ${
                  active
                    ? "bg-terminal-green/10 text-terminal-green"
                    : "text-foreground hover:bg-secondary"
                }`}
              >
                <div className="flex flex-col gap-0">
                  <span className="text-[10px] font-bold tracking-wider">
                    {b.shortName}
                  </span>
                  <span className="text-[9px] text-muted-foreground">
                    {b.name}
                  </span>
                </div>
                {active && (
                  <Check className="h-3 w-3 shrink-0 text-terminal-green" />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function BrokerAccountsSection() {
  const { brokers, activeBrokerId, setActiveBroker, connectionStatus } =
    useBroker();
  const [open, setOpen] = useState(false);
  const [configuringBrokerId, setConfiguringBroker] = useState<string | null>(
    null,
  );
  const dropdownRef = useRef<HTMLDivElement>(null);

  const configuringBrokerData = brokers.find(
    (b) => b.id === configuringBrokerId,
  );

  // Close the dropdown on outside clicks (same pattern as the header's
  // scheme switcher and ActiveBrokerSwitcher).
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className="flex flex-col gap-4">
      {/* Inline row: label + dropdown */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col gap-0.5">
          <span className="text-xs font-bold text-foreground">
            EXECUTION ROUTING
          </span>
          <span className="text-[10px] text-muted-foreground">
            Configured via this panel &middot; encrypted server-side
          </span>
        </div>
        <div className="relative" ref={dropdownRef}>
          <button
            type="button"
            onClick={() => setOpen(!open)}
            className="flex items-center gap-2 border border-border bg-secondary px-3 py-1 text-xs text-foreground hover:border-terminal-green/40 transition-colors"
          >
            <span className="flex items-center gap-1.5">
              <ConnectionDot id="okx" />
              <span>OKX / PAPER</span>
            </span>
            <ChevronDown
              className={`h-3 w-3 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
            />
          </button>
          {open && (
            <div className="absolute right-0 top-full z-50 mt-1 min-w-55 border border-border bg-card shadow-lg shadow-black/40">
              {brokers.map((broker) => {
                const isActive = broker.id === activeBrokerId;
                const status = connectionStatus(broker.id);
                return (
                  <button
                    type="button"
                    key={broker.id}
                    onClick={() => {
                      if (status === "connected" && broker.tradingEnabled) {
                        setActiveBroker(broker.id);
                        setOpen(false);
                      } else {
                        setConfiguringBroker(broker.id);
                        setOpen(false);
                      }
                    }}
                    className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-xs transition-colors hover:bg-terminal-green/10 ${
                      isActive ? "text-terminal-green" : "text-foreground"
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <ConnectionDot id={broker.id} />
                      <span className="flex flex-col items-start gap-0">
                        <span className="font-bold tracking-wider">
                          {broker.shortName}
                        </span>
                        <span className="text-[9px] text-muted-foreground">
                          {broker.name}
                        </span>
                      </span>
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="text-[9px] font-bold tracking-wider text-terminal-dim">
                        {status === "connected"
                          ? broker.tradingEnabled
                            ? "ENABLED"
                            : "ENABLE"
                          : status === "pending"
                            ? "CHECKING"
                            : "SETUP"}
                      </span>
                      {isActive && (
                        <Check className="h-3 w-3 shrink-0 text-terminal-green" />
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Configuration panel (inline expand) */}
      {configuringBrokerData && (
        <div className="border border-terminal-cyan/30 bg-terminal-cyan/5 p-3">
          <BrokerConfigPanel
            broker={configuringBrokerData}
            onClose={() => setConfiguringBroker(null)}
          />
        </div>
      )}
    </div>
  );
}

/** Connection dot derived from server state (never from user input). */
function ConnectionDot({ id }: { id: string }) {
  const { connectionStatus } = useBroker();
  const status = connectionStatus(id);
  return (
    <span
      className={`h-1.5 w-1.5 shrink-0 ${
        status === "connected"
          ? "bg-terminal-green"
          : status === "pending"
            ? "bg-terminal-amber animate-pulse"
            : "bg-terminal-dim"
      }`}
    />
  );
}
