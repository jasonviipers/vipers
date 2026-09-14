"use client";

import { useQuery } from "@tanstack/react-query";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

export type BrokerStatus = "connected" | "disconnected" | "pending" | "error";

export type BrokerAccountType = "stocks" | "crypto" | "multi-asset";

/** Server-derived broker state from GET /api/broker/status. */
export interface BrokerServerStatus {
  credentials: { apiKey: boolean; passphrase: boolean; secret: boolean };
  id: string;
  mode: "live" | "paper";
}

export interface BrokerAccount {
  id: string;
  name: string;
  shortName: string;
  accountType: BrokerAccountType;
  description: string;
  supportedAssets: string[];
  // --- operator preference (persisted locally) ---
  /** Explicit operator opt-in for execution routing on this broker. */
  tradingEnabled: boolean;
}

/**
 * Static broker catalog. Broker connection is decided SERVER-side by
 * environment configuration (see GET /api/broker/status and the execution
 * tool's routing rule) — there is no user-typed-key connect flow. The only
 * operator-controlled state is `tradingEnabled`, a local kill-switch-style
 * opt-in persisted here.
 */
export const BROKER_CATALOG: Omit<BrokerAccount, "tradingEnabled">[] = [
  {
    id: "okx",
    name: "OKX",
    shortName: "OKX",
    accountType: "crypto",
    description:
      "Spot trading on USDT-quoted majors. Routing is decided server-side: OKX when credentials are configured via environment variables (OKX_DEMO=true for the paper endpoints), otherwise the paper book.",
    supportedAssets: ["BTC", "ETH", "SOL", "XRP", "DOGE"],
  },
  {
    id: "alpaca",
    name: "Alpaca Markets",
    shortName: "ALPACA",
    accountType: "stocks",
    description:
      "US equities adapter is not wired to a broker yet; equity symbols execute on the paper book only.",
    supportedAssets: ["AAPL", "NVDA", "TSLA", "SPY"],
  },
];

/** Persisted operator preference per broker. */
interface StoredBrokerState {
  tradingEnabled: boolean;
}

interface StoredBrokerData {
  activeBrokerId: string | null;
  brokers: Record<string, StoredBrokerState>;
}

type BrokerContextValue = {
  brokers: BrokerAccount[];
  activeBrokerId: string | null;
  activeBroker: BrokerAccount;
  /** Brokers that are server-connected AND explicitly enabled by the operator. */
  connectedBrokers: BrokerAccount[];
  /** Server-derived connection state; null until the first fetch resolves. */
  serverStatus: BrokerServerStatus | null;
  /** Per-broker connection status derived from the server payload. */
  connectionStatus: (id: string) => BrokerStatus;
  setActiveBroker: (id: string) => void;
  setTradingEnabled: (id: string, enabled: boolean) => void;
};

const STORAGE_KEY = "viipers_broker_accounts";

const BrokerContext = createContext<BrokerContextValue | null>(null);

function defaultStoredState(): StoredBrokerState {
  // Trading starts disabled: an explicit operator action must enable a
  // broker for execution (kill-switch default).
  return { tradingEnabled: false };
}

function readStoredData(): StoredBrokerData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && "brokers" in parsed) {
        return parsed as StoredBrokerData;
      }
    }
  } catch {
    // localStorage/JSON can throw in private browsing contexts; fall
    // through to defaults rather than crashing the settings view
  }
  return { activeBrokerId: null, brokers: {} };
}

function writeStoredData(data: StoredBrokerData): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // ignore write failures (quota exceeded, storage disabled, etc.)
  }
}

/** Merge the code-owned catalog with persisted operator preferences. */
function hydrateBrokers(stored: StoredBrokerData): BrokerAccount[] {
  return BROKER_CATALOG.map((broker) => ({
    ...broker,
    tradingEnabled:
      stored.brokers[broker.id]?.tradingEnabled ??
      defaultStoredState().tradingEnabled,
  }));
}

function toStoredBrokers(
  brokers: BrokerAccount[],
): Record<string, StoredBrokerState> {
  const out: Record<string, StoredBrokerState> = {};
  for (const broker of brokers) {
    out[broker.id] = { tradingEnabled: broker.tradingEnabled };
  }
  return out;
}

/**
 * Derive the per-broker connection status from the server payload — never
 * from anything the user typed. OKX is connected when the server reports
 * all three credentials present (live or demo); the alpaca adapter has no
 * broker wiring yet, so it is always disconnected.
 */
function deriveConnectionStatus(
  id: string,
  serverStatus: BrokerServerStatus | null,
): BrokerStatus {
  if (id === "okx") {
    if (!serverStatus) {
      return "pending"; // server truth not loaded yet
    }
    const { apiKey, passphrase, secret } = serverStatus.credentials;
    return apiKey && passphrase && secret ? "connected" : "disconnected";
  }
  return "disconnected";
}

export function BrokerProvider({ children }: { children: ReactNode }) {
  const [brokers, setBrokers] = useState<BrokerAccount[]>(() =>
    hydrateBrokers({ activeBrokerId: null, brokers: {} }),
  );
  const [activeBrokerId, setActiveBrokerId] = useState<string | null>(null);
  // Gates the persist effect until stored state has been read, so the
  // initial in-memory defaults are never written over real saved data
  // (StrictMode's double effect pass made that race destructive).
  const [hydrated, setHydrated] = useState(false);

  // Server-owned broker truth (credentials configured? live or demo?).
  // The UI mirrors this; it can never contradict the execution tool's
  // actual routing decision because both read the same env-derived state.
  const { data: serverStatus } = useQuery<BrokerServerStatus>({
    queryFn: async () => {
      const res = await fetch("/api/broker/status");
      if (!res.ok) {
        throw new Error(`API ${res.status}: ${res.statusText}`);
      }
      return (await res.json()) as BrokerServerStatus;
    },
    queryKey: ["broker", "status"],
    refetchInterval: 30_000,
    staleTime: 30_000,
  });

  // Hydrate from localStorage on mount (SSR-safe: storage is only touched
  // in effects, so server and first client render match).
  useEffect(() => {
    const stored = readStoredData();
    setBrokers(hydrateBrokers(stored));
    setActiveBrokerId(stored.activeBrokerId);
    setHydrated(true);
  }, []);

  // Single writer: every state change re-persists the derived blob.
  useEffect(() => {
    if (!hydrated) {
      return;
    }
    writeStoredData({
      activeBrokerId,
      brokers: toStoredBrokers(brokers),
    });
  }, [brokers, activeBrokerId, hydrated]);

  const setActiveBroker = useCallback((id: string) => {
    setActiveBrokerId(id);
  }, []);

  // Local operator preference — persisted synchronously via the single
  // writer effect above. This is a client-side gate only; the server's
  // env-based routing is authoritative and cannot be changed from here.
  const setTradingEnabled = useCallback((id: string, enabled: boolean) => {
    setBrokers((prev) =>
      prev.map((broker) =>
        broker.id === id ? { ...broker, tradingEnabled: enabled } : broker,
      ),
    );
  }, []);

  const connectedBrokers = useMemo(
    () =>
      brokers.filter(
        (broker) =>
          deriveConnectionStatus(broker.id, serverStatus ?? null) ===
            "connected" && broker.tradingEnabled,
      ),
    [brokers, serverStatus],
  );

  const activeBroker = useMemo(() => {
    const byId = brokers.find((broker) => broker.id === activeBrokerId);
    return byId ?? connectedBrokers[0] ?? brokers[0];
  }, [brokers, activeBrokerId, connectedBrokers]);

  const connectionStatus = useCallback(
    (id: string) => deriveConnectionStatus(id, serverStatus ?? null),
    [serverStatus],
  );

  return (
    <BrokerContext.Provider
      value={{
        activeBroker,
        activeBrokerId,
        brokers,
        connectedBrokers,
        connectionStatus,
        serverStatus: serverStatus ?? null,
        setActiveBroker,
        setTradingEnabled,
      }}
    >
      {children}
    </BrokerContext.Provider>
  );
}

export function useBroker() {
  const ctx = useContext(BrokerContext);
  if (!ctx) throw new Error("useBroker must be used within BrokerProvider");
  return ctx;
}
