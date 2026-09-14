"use client";

import {
  Check,
  ChevronDown,
  CircleSlash,
  KeyRound,
  Loader2,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  type BrokerAccount,
  type BrokerStatus,
  useBroker,
} from "@/context/broker-context";

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

/**
 * Broker configuration panel.
 *
 * Connection state is SERVER-OWNED: OKX is connected when the deployment's
 * environment carries OKX_API_KEY / OKX_SECRET / OKX_PASSPHRASE (with
 * OKX_DEMO choosing the paper endpoints). Credentials never pass through
 * the browser, so there is deliberately no key-entry form here — the panel
 * reports the real routing state and exposes the one operator control:
 * enabling/disabling trading on this broker (a local preference).
 */
function BrokerConfigPanel({
  broker,
  onClose,
}: {
  broker: BrokerAccount;
  onClose: () => void;
}) {
  const { serverStatus, connectionStatus, setTradingEnabled } = useBroker();
  const status = connectionStatus(broker.id);
  const isOkx = broker.id === "okx";
  const isEnabled = broker.tradingEnabled;

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
            SERVER-SIDE ROUTING
          </span>
          <span className="text-[9px] text-muted-foreground leading-relaxed">
            Broker credentials live in the server environment and are never
            entered in the browser. The execution team routes through OKX when
            the server has credentials; otherwise every order fills on the paper
            book.
          </span>
        </div>
      </div>

      {/* OKX credential truth from the server */}
      {isOkx &&
        (serverStatus ? (
          <div className="flex flex-col gap-1.5 border border-border bg-secondary/50 p-2">
            <span className="text-[9px] font-bold tracking-wider text-muted-foreground">
              SERVER CREDENTIALS
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
              <span
                className={`text-[9px] font-bold ${serverStatus.mode === "live" ? "text-terminal-red" : "text-terminal-amber"}`}
              >
                {serverStatus.mode === "live"
                  ? "LIVE — REAL CAPITAL"
                  : "DEMO — PAPER ENDPOINTS"}
              </span>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 border border-border bg-secondary/50 p-2 text-[10px] text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            Checking server configuration…
          </div>
        ))}

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
          ? "CONFIGURE SERVER CREDENTIALS TO ENABLE"
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
            Decided by server configuration &middot; all trades route here
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
