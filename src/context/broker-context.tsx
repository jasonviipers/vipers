"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
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

/** Active credential-auth health from GET /api/broker/status. */
export interface BrokerAuthHealth {
  checkedAt: string;
  hint?: string;
  healthy: boolean;
  okxCode?: string;
  reason?: string;
}

/** Per-mode slot presence from GET /api/broker/status (booleans only). */
export interface BrokerSlotPresence {
  apiKeySet: boolean;
  passphraseSet: boolean;
  secretSet: boolean;
}

/** Server-derived broker state from GET /api/broker/status?broker=<id>. */
export interface BrokerServerStatus {
  auth?: BrokerAuthHealth;
  credentials: { apiKey: boolean; passphrase: boolean; secret: boolean };
  id: string;
  mode: "live" | "paper";
  /** Whether this broker uses a passphrase at all (OKX yes, Alpaca no). */
  requiresPassphrase: boolean;
  /** Demo AND live credential slots — the switch renders from this. */
  slots?: { demo: BrokerSlotPresence; live: BrokerSlotPresence };
  region?: string;
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
 * Static broker catalog. Broker connection is decided SERVER-side by the
 * stored credentials (broker_credentials table — see GET /api/broker/status
 * and the execution tool's routing rule). Operations connect a broker by
 * saving credentials in the /settings panel; `tradingEnabled` is an
 * additional local opt-in persisted here.
 */
const BROKER_CATALOG: Omit<BrokerAccount, "tradingEnabled">[] = [
  {
    id: "okx",
    name: "OKX",
    shortName: "OKX",
    accountType: "crypto",
    description:
      "Spot trading on USDT-quoted majors. Save your OKX API credentials in this panel (encrypted server-side); DEMO mode routes through the local paper book, LIVE mode trades real capital.",
    supportedAssets: ["BTC", "ETH", "SOL", "XRP", "DOGE"],
  },
  {
    id: "alpaca",
    name: "Alpaca Markets",
    shortName: "ALPACA",
    accountType: "multi-asset",
    description:
      "US equities + crypto (BTC/USD, ETH/USD) via the Alpaca trade API. DEMO credentials hit the Alpaca PAPER account, LIVE credentials trade real capital — same two-slot demo/live switch as OKX.",
    supportedAssets: ["AAPL", "NVDA", "TSLA", "SPY", "BTC", "ETH"],
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
  /** Local (optimistic) selection — the server setting is authoritative. */
  activeBrokerId: string | null;
  /** Durable server-side selection from GET /api/settings/runtime. */
  serverActiveBrokerId: string | null;
  activeBroker: BrokerAccount;
  /** Brokers that are server-connected AND explicitly enabled by the operator. */
  connectedBrokers: BrokerAccount[];
  /** Server-derived connection state per broker; null until first fetch. */
  serverStatuses: Record<string, BrokerServerStatus | null>;
  /** Per-broker connection status derived from the server payload. */
  connectionStatus: (id: string) => BrokerStatus;
  /**
   * Switch the durable execution broker (PUT /api/settings/runtime).
   * Resolves to false when the target is not connected+enabled or the
   * server rejected the switch.
   */
  setActiveBroker: (id: string) => Promise<boolean>;
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
 * from anything the user typed. A broker is connected when the server
 * reports all REQUIRED credential fields present (passphrase only matters
 * for brokers that use one). Not-yet-fetched status is "pending".
 */
function deriveConnectionStatus(
  _id: string,
  status: BrokerServerStatus | null | undefined,
): BrokerStatus {
  if (!status) {
    return "pending";
  }
  const { apiKey, passphrase, secret } = status.credentials;
  const complete =
    apiKey && secret && (passphrase || status.requiresPassphrase === false);
  return complete ? "connected" : "disconnected";
}

export function BrokerProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [brokers, setBrokers] = useState<BrokerAccount[]>(() =>
    hydrateBrokers({ activeBrokerId: null, brokers: {} }),
  );
  const [activeBrokerId, setActiveBrokerId] = useState<string | null>(null);
  // Gates the persist effect until stored state has been read, so the
  // initial in-memory defaults are never written over real saved data
  // (StrictMode's double effect pass made that race destructive).
  const [hydrated, setHydrated] = useState(false);

  // Server-owned broker statuses (credentials configured? live or demo?).
  // The UI mirrors this; it can never contradict the execution tool's
  // actual routing decision because both read the same DB-derived state.
  const { data: serverStatuses } = useQuery<
    Record<string, BrokerServerStatus | null>
  >({
    queryFn: async () => {
      const entries = await Promise.all(
        BROKER_CATALOG.map(async (broker) => {
          try {
            const res = await fetch(`/api/broker/status?broker=${broker.id}`);
            if (!res.ok) {
              return [broker.id, null] as const;
            }
            return [
              broker.id,
              (await res.json()) as BrokerServerStatus,
            ] as const;
          } catch {
            return [broker.id, null] as const;
          }
        }),
      );
      return Object.fromEntries(entries);
    },
    queryKey: ["broker", "statuses"],
    refetchInterval: 30_000,
    staleTime: 30_000,
  });

  // Durable server-side broker selection — the routing target the
  // execution tool actually uses. Not derived from localStorage.
  const { data: runtimeSettings } = useQuery<{ activeBrokerId?: string }>({
    queryFn: async () => {
      const res = await fetch("/api/settings/runtime");
      if (!res.ok) {
        throw new Error(`API ${res.status}: ${res.statusText}`);
      }
      return (await res.json()) as { activeBrokerId?: string };
    },
    queryKey: ["settings", "runtime"],
    refetchInterval: 30_000,
    staleTime: 30_000,
  });
  const serverActiveBrokerId = runtimeSettings?.activeBrokerId ?? null;

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

  // Switching the active broker is a SERVER-side durable decision: the
  // execution pipeline reads runtime_settings.activeBrokerId, never client
  // state. Only connected + explicitly enabled brokers can be selected.
  const setActiveBroker = useCallback(
    async (id: string): Promise<boolean> => {
      const target = brokers.find((broker) => broker.id === id);
      if (!target) {
        return false;
      }
      const status = deriveConnectionStatus(id, serverStatuses?.[id] ?? null);
      if (status !== "connected" || !target.tradingEnabled) {
        return false;
      }

      const previous = activeBrokerId;
      setActiveBrokerId(id);
      try {
        const res = await fetch("/api/settings/runtime", {
          body: JSON.stringify({ activeBrokerId: id }),
          headers: { "content-type": "application/json" },
          method: "PUT",
        });
        if (!res.ok) {
          throw new Error(`switch failed (${res.status})`);
        }
        // Re-pull the durable setting + broker truth so every consumer
        // follows the new routing immediately.
        queryClient.invalidateQueries({ queryKey: ["settings", "runtime"] });
        queryClient.invalidateQueries({ queryKey: ["status"] });
        return true;
      } catch (error) {
        // Revert the optimistic selection — the server is authoritative.
        setActiveBrokerId(previous);
        console.error(error);
        return false;
      }
    },
    [activeBrokerId, brokers, queryClient, serverStatuses],
  );

  // Local operator preference — persisted synchronously via the single
  // writer effect above. This is a client-side gate only; the server's
  // routing is authoritative and cannot be changed from here.
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
          deriveConnectionStatus(broker.id, serverStatuses?.[broker.id]) ===
            "connected" && broker.tradingEnabled,
      ),
    [brokers, serverStatuses],
  );

  const activeBroker = useMemo(() => {
    // Server-side selection wins when it is connected + enabled; otherwise
    // fall back to the local selection, then the first enabled broker.
    const byServer = brokers.find(
      (broker) => broker.id === serverActiveBrokerId && broker.tradingEnabled,
    );
    if (byServer && connectedBrokers.includes(byServer)) {
      return byServer;
    }
    const byLocal = brokers.find((broker) => broker.id === activeBrokerId);
    if (byLocal && connectedBrokers.includes(byLocal)) {
      return byLocal;
    }
    return connectedBrokers[0] ?? brokers[0];
  }, [activeBrokerId, brokers, connectedBrokers, serverActiveBrokerId]);

  const connectionStatus = useCallback(
    (id: string) => deriveConnectionStatus(id, serverStatuses?.[id] ?? null),
    [serverStatuses],
  );

  const providerValue = useMemo<BrokerContextValue>(
    () => ({
      activeBroker,
      activeBrokerId,
      brokers,
      connectedBrokers,
      connectionStatus,
      serverActiveBrokerId,
      serverStatuses: serverStatuses ?? {},
      setActiveBroker,
      setTradingEnabled,
    }),
    [
      activeBroker,
      activeBrokerId,
      brokers,
      connectedBrokers,
      connectionStatus,
      serverActiveBrokerId,
      serverStatuses,
      setActiveBroker,
      setTradingEnabled,
    ],
  );

  return (
    <BrokerContext.Provider value={providerValue}>
      {children}
    </BrokerContext.Provider>
  );
}

export function useBroker() {
  const ctx = useContext(BrokerContext);
  if (!ctx) throw new Error("useBroker must be used within BrokerProvider");
  return ctx;
}
