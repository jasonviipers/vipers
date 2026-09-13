"use client";

import {
  AlertTriangle,
  Check,
  ChevronDown,
  ExternalLink,
  Eye,
  EyeOff,
  Key,
  KeyRound,
  Link2,
  Link2Off,
  Loader2,
  Shield,
  Wallet,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  type BrokerAccount,
  type BrokerStatus,
  useBroker,
} from "@/context/broker-context";
import { fmtDollar } from "@/lib/format";

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
    disconnected: "OFFLINE",
    pending: "PENDING",
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
      {status === "error" && <AlertTriangle className="h-2.5 w-2.5" />}
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

// OKX requires a third credential (the API passphrase set when the key was
// created) in addition to the key/secret pair every other broker uses here.
function isOkxBroker(broker: BrokerAccount): boolean {
  return (
    broker.id?.toLowerCase() === "okx" ||
    broker.shortName?.toLowerCase() === "okx"
  );
}

function BrokerConfigPanel({
  broker,
  onClose,
}: {
  broker: BrokerAccount;
  onClose: () => void;
}) {
  const { updateBrokerKeys, disconnectBroker, setActiveBroker } = useBroker();
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [apiPassphrase, setApiPassphrase] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [showSecret, setShowSecret] = useState(false);
  const [showPassphrase, setShowPassphrase] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [connected, setConnected] = useState(false);

  const isCurrentlyConnected = broker.status === "connected";
  const isOkx = isOkxBroker(broker);
  const canConnect =
    apiKey.trim().length > 0 &&
    (!isOkx || apiPassphrase.trim().length > 0) &&
    !connecting;

  function handleConnect() {
    if (!canConnect) return;
    setConnecting(true);
    // Simulate connection
    setTimeout(() => {
      updateBrokerKeys(broker.id, {
        apiKeySet: true,
        apiSecretSet: apiSecret.length > 0,
        ...(isOkx ? { apiPassphraseSet: apiPassphrase.length > 0 } : {}),
        status: "connected",
        accountId: `${broker.shortName}-****${Math.floor(1000 + Math.random() * 9000)}`,
        balance: Math.round((10000 + Math.random() * 200000) * 100) / 100,
        lastSync: new Date(),
      });
      setConnecting(false);
      setConnected(true);
      setActiveBroker(broker.id);
      setTimeout(() => onClose(), 1200);
    }, 1500);
  }

  function handleDisconnect() {
    disconnectBroker(broker.id);
    onClose();
  }

  function handleOAuth() {
    setConnecting(true);
    setTimeout(() => {
      updateBrokerKeys(broker.id, {
        oauthConnected: true,
        status: "connected",
        accountId: `${broker.shortName}-****${Math.floor(1000 + Math.random() * 9000)}`,
        balance: Math.round((10000 + Math.random() * 200000) * 100) / 100,
        lastSync: new Date(),
      });
      setConnecting(false);
      setConnected(true);
      setActiveBroker(broker.id);
      setTimeout(() => onClose(), 1200);
    }, 2000);
  }

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
        <BrokerStatusBadge status={connected ? "connected" : broker.status} />
      </div>

      <p className="text-[10px] text-muted-foreground leading-relaxed">
        {broker.description}
      </p>

      {/* Security notice */}
      <div className="flex items-start gap-2 border border-terminal-amber/20 bg-terminal-amber/5 p-2.5">
        <Shield className="h-3.5 w-3.5 text-terminal-amber shrink-0 mt-0.5" />
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] font-bold text-terminal-amber">
            SECURITY
          </span>
          <span className="text-[9px] text-muted-foreground leading-relaxed">
            API credentials are encrypted at rest and never transmitted in
            plaintext. Use read-only keys when possible. Revoke access at any
            time from your broker dashboard.
          </span>
        </div>
      </div>

      {/* Auth method */}
      {(broker.authMethod === "oauth" || broker.authMethod === "both") &&
        !isCurrentlyConnected && (
          <div className="flex flex-col gap-2">
            <span className="text-[10px] font-bold tracking-wider text-muted-foreground">
              OAUTH CONNECTION
            </span>
            <button
              type="button"
              onClick={handleOAuth}
              disabled={connecting}
              className="flex items-center justify-center gap-2 border border-border bg-secondary py-2 text-[10px] font-bold tracking-wider text-foreground hover:border-terminal-green/40 hover:bg-terminal-green/5 transition-colors disabled:opacity-50"
            >
              {connecting ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" />
                  AUTHORIZING...
                </>
              ) : (
                <>
                  <ExternalLink className="h-3 w-3" />
                  CONNECT WITH {broker.shortName}
                </>
              )}
            </button>
            {broker.authMethod === "both" && (
              <div className="flex items-center gap-2 text-[9px] text-terminal-dim">
                <div className="flex-1 border-t border-border" />
                <span>OR USE API KEYS</span>
                <div className="flex-1 border-t border-border" />
              </div>
            )}
          </div>
        )}

      {/* API Key inputs */}
      {(broker.authMethod === "api_key" || broker.authMethod === "both") &&
        !isCurrentlyConnected && (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold tracking-wider text-muted-foreground">
                  API KEY
                </span>
                {broker.apiKeySet && (
                  <span className="text-[9px] font-bold text-terminal-green">
                    SET
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <div className="flex flex-1 items-center gap-2 border border-border bg-secondary px-3 py-1.5">
                  <Key className="h-3 w-3 text-muted-foreground shrink-0" />
                  <input
                    type={showKey ? "text" : "password"}
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder={`${broker.shortName} API key...`}
                    className="w-full bg-transparent text-xs text-foreground outline-none placeholder:text-terminal-dim font-mono"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => setShowKey(!showKey)}
                  className="border border-border bg-secondary p-1.5 text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showKey ? (
                    <EyeOff className="h-3 w-3" />
                  ) : (
                    <Eye className="h-3 w-3" />
                  )}
                </button>
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold tracking-wider text-muted-foreground">
                  API SECRET
                </span>
                {broker.apiSecretSet && (
                  <span className="text-[9px] font-bold text-terminal-green">
                    SET
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <div className="flex flex-1 items-center gap-2 border border-border bg-secondary px-3 py-1.5">
                  <Shield className="h-3 w-3 text-muted-foreground shrink-0" />
                  <input
                    type={showSecret ? "text" : "password"}
                    value={apiSecret}
                    onChange={(e) => setApiSecret(e.target.value)}
                    placeholder={`${broker.shortName} API secret...`}
                    className="w-full bg-transparent text-xs text-foreground outline-none placeholder:text-terminal-dim font-mono"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => setShowSecret(!showSecret)}
                  className="border border-border bg-secondary p-1.5 text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showSecret ? (
                    <EyeOff className="h-3 w-3" />
                  ) : (
                    <Eye className="h-3 w-3" />
                  )}
                </button>
              </div>
            </div>

            {/* OKX-only: API passphrase set at key creation time */}
            {isOkx && (
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold tracking-wider text-muted-foreground">
                    API PASSPHRASE
                  </span>
                  {broker.apiPassphraseSet && (
                    <span className="text-[9px] font-bold text-terminal-green">
                      SET
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex flex-1 items-center gap-2 border border-border bg-secondary px-3 py-1.5">
                    <KeyRound className="h-3 w-3 text-muted-foreground shrink-0" />
                    <input
                      type={showPassphrase ? "text" : "password"}
                      value={apiPassphrase}
                      onChange={(e) => setApiPassphrase(e.target.value)}
                      placeholder="OKX API passphrase..."
                      className="w-full bg-transparent text-xs text-foreground outline-none placeholder:text-terminal-dim font-mono"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowPassphrase(!showPassphrase)}
                    className="border border-border bg-secondary p-1.5 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {showPassphrase ? (
                      <EyeOff className="h-3 w-3" />
                    ) : (
                      <Eye className="h-3 w-3" />
                    )}
                  </button>
                </div>
                <span className="text-[9px] text-terminal-dim leading-relaxed">
                  The passphrase you set when generating this key on OKX — not
                  your account password.
                </span>
              </div>
            )}

            <button
              type="button"
              onClick={handleConnect}
              disabled={!canConnect}
              className="flex items-center justify-center gap-2 bg-terminal-green py-2 text-[10px] font-bold tracking-wider text-primary-foreground hover:bg-terminal-green/80 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {connecting ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" />
                  CONNECTING...
                </>
              ) : connected ? (
                <>
                  <Check className="h-3 w-3" />
                  CONNECTED
                </>
              ) : (
                <>
                  <Link2 className="h-3 w-3" />
                  CONNECT BROKER
                </>
              )}
            </button>
          </div>
        )}

      {/* Connected state management */}
      {isCurrentlyConnected && (
        <div className="flex flex-col gap-3">
          {/* Account info */}
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-0.5 border border-border bg-secondary/50 p-2">
              <span className="text-[9px] text-muted-foreground">
                ACCOUNT ID
              </span>
              <span className="text-[10px] font-mono font-bold text-foreground">
                {broker.accountId ?? "---"}
              </span>
            </div>
            <div className="flex flex-col gap-0.5 border border-border bg-secondary/50 p-2">
              <span className="text-[9px] text-muted-foreground">BALANCE</span>
              <span className="text-[10px] font-mono font-bold text-terminal-green">
                {broker.balance !== undefined
                  ? fmtDollar(broker.balance)
                  : "---"}
              </span>
            </div>
          </div>

          {/* Credentials status */}
          <div className="flex flex-col gap-1.5 border border-border bg-secondary/50 p-2">
            <span className="text-[9px] font-bold tracking-wider text-muted-foreground">
              CREDENTIALS
            </span>
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-foreground">API Key</span>
              <span
                className={`text-[9px] font-bold ${broker.apiKeySet ? "text-terminal-green" : "text-terminal-dim"}`}
              >
                {broker.apiKeySet ? "CONFIGURED" : "NOT SET"}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-foreground">API Secret</span>
              <span
                className={`text-[9px] font-bold ${broker.apiSecretSet ? "text-terminal-green" : "text-terminal-dim"}`}
              >
                {broker.apiSecretSet ? "CONFIGURED" : "NOT SET"}
              </span>
            </div>
            {isOkx && (
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-foreground">
                  API Passphrase
                </span>
                <span
                  className={`text-[9px] font-bold ${broker.apiPassphraseSet ? "text-terminal-green" : "text-terminal-dim"}`}
                >
                  {broker.apiPassphraseSet ? "CONFIGURED" : "NOT SET"}
                </span>
              </div>
            )}
            {broker.authMethod !== "api_key" && (
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-foreground">OAuth</span>
                <span
                  className={`text-[9px] font-bold ${broker.oauthConnected ? "text-terminal-green" : "text-terminal-dim"}`}
                >
                  {broker.oauthConnected ? "AUTHORIZED" : "NOT SET"}
                </span>
              </div>
            )}
          </div>

          {/* Supported assets */}
          <div className="flex flex-col gap-1.5">
            <span className="text-[9px] font-bold tracking-wider text-muted-foreground">
              SUPPORTED ASSETS
            </span>
            <div className="flex flex-wrap gap-1">
              {broker.supportedAssets.map((asset) => (
                <span
                  key={asset}
                  className="bg-secondary border border-border px-1.5 py-0.5 text-[9px] text-foreground"
                >
                  {asset}
                </span>
              ))}
            </div>
          </div>

          {/* Disconnect */}
          <button
            type="button"
            onClick={handleDisconnect}
            className="flex items-center justify-center gap-1.5 border border-terminal-red/30 bg-terminal-red/5 py-1.5 text-[10px] font-bold tracking-wider text-terminal-red hover:bg-terminal-red/10 transition-colors"
          >
            <Link2Off className="h-3 w-3" />
            DISCONNECT BROKER
          </button>
        </div>
      )}

      {/* Close */}
      <button
        type="button"
        onClick={onClose}
        className="flex items-center justify-center border border-border bg-secondary py-1.5 text-[10px] font-bold tracking-wider text-muted-foreground hover:text-foreground transition-colors"
      >
        {isCurrentlyConnected ? "DONE" : "CANCEL"}
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
                <div className="flex items-center gap-2">
                  {b.balance !== undefined && (
                    <span className="text-[9px] font-mono text-terminal-green">
                      {fmtDollar(b.balance)}
                    </span>
                  )}
                  {active && (
                    <Check className="h-3 w-3 shrink-0 text-terminal-green" />
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function BrokerAccountsSection() {
  const {
    brokers,
    activeBrokerId,
    activeBroker,
    setActiveBroker,
    connectedBrokers,
  } = useBroker();
  const [open, setOpen] = useState(false);
  const [configuringBrokerId, setConfiguringBroker] = useState<string | null>(
    null,
  );
  const dropdownRef = useRef<HTMLDivElement>(null);

  const configuringBrokerData = brokers.find(
    (b) => b.id === configuringBrokerId,
  );
  const connectedCount = connectedBrokers.length;

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
            ACTIVE BROKER
          </span>
          <span className="text-[10px] text-muted-foreground">
            {connectedCount} connected &middot; All trades route here
          </span>
        </div>
        <div className="relative" ref={dropdownRef}>
          <button
            type="button"
            onClick={() => setOpen(!open)}
            className="flex items-center gap-2 border border-border bg-secondary px-3 py-1 text-xs text-foreground hover:border-terminal-green/40 transition-colors"
          >
            <span className="flex items-center gap-1.5">
              <span
                className={`h-1.5 w-1.5 shrink-0 ${
                  activeBroker.status === "connected"
                    ? "bg-terminal-green animate-pulse"
                    : activeBroker.status === "pending"
                      ? "bg-terminal-amber"
                      : "bg-terminal-dim"
                }`}
              />
              <span>{activeBroker.shortName}</span>
            </span>
            <ChevronDown
              className={`h-3 w-3 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
            />
          </button>
          {open && (
            <div className="absolute right-0 top-full z-50 mt-1 min-w-55 border border-border bg-card shadow-lg shadow-black/40">
              {brokers.map((broker) => {
                const isActive = broker.id === activeBrokerId;
                const isConnected = broker.status === "connected";
                return (
                  <button
                    type="button"
                    key={broker.id}
                    onClick={() => {
                      if (isConnected) {
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
                      <span
                        className={`h-1.5 w-1.5 shrink-0 ${
                          broker.status === "connected"
                            ? "bg-terminal-green"
                            : broker.status === "pending"
                              ? "bg-terminal-amber"
                              : "bg-terminal-dim"
                        }`}
                      />
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
                      {isConnected && broker.balance !== undefined && (
                        <span className="text-[9px] font-mono text-terminal-green">
                          {fmtDollar(broker.balance)}
                        </span>
                      )}
                      {!isConnected && (
                        <span className="text-[9px] font-bold tracking-wider text-terminal-dim">
                          {broker.status === "pending" ? "PENDING" : "CONNECT"}
                        </span>
                      )}
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
