"use client";

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

export type BrokerAuthMethod = "oauth" | "api_key" | "both";

export interface BrokerAccount {
  id: string;
  name: string;
  shortName: string;
  accountType: BrokerAccountType;
  authMethod: BrokerAuthMethod;
  description: string;
  supportedAssets: string[];
  // --- mutable connection state (persisted) ---
  status: BrokerStatus;
  apiKeySet: boolean;
  apiSecretSet: boolean;
  /** OKX-only: passphrase set when the API key was created. */
  apiPassphraseSet: boolean;
  oauthConnected: boolean;
  accountId?: string;
  balance?: number;
  /** In-memory Date; persisted as an ISO string. */
  lastSync?: Date;
}

/**
 * Static broker catalog. Connection state lives in the persisted slice;
 * these fields are code-owned so catalog updates ship with deploys.
 */
export const BROKER_CATALOG: Omit<
  BrokerAccount,
  | "status"
  | "apiKeySet"
  | "apiSecretSet"
  | "apiPassphraseSet"
  | "oauthConnected"
>[] = [
  {
    id: "okx",
    name: "OKX",
    shortName: "OKX",
    accountType: "crypto",
    authMethod: "api_key",
    description:
      "Spot trading on USDT-quoted majors. The execution team routes live orders through OKX when credentials are configured on the server.",
    supportedAssets: ["BTC", "ETH", "SOL", "XRP", "DOGE"],
  },
  {
    id: "alpaca",
    name: "Alpaca Markets",
    shortName: "ALPACA",
    accountType: "stocks",
    authMethod: "api_key",
    description:
      "Commission-free US equities API. Supports fractional shares and extended-hours trading.",
    supportedAssets: ["AAPL", "NVDA", "TSLA", "SPY"],
  },
];

/** Persisted, mutable per-broker connection state. */
interface StoredBrokerState {
  accountId?: string;
  apiKeySet: boolean;
  apiSecretSet: boolean;
  apiPassphraseSet: boolean;
  balance?: number;
  lastSync?: string;
  oauthConnected: boolean;
  status: BrokerStatus;
}

interface StoredBrokerData {
  activeBrokerId: string | null;
  brokers: Record<string, StoredBrokerState>;
}

type BrokerContextValue = {
  brokers: BrokerAccount[];
  activeBrokerId: string | null;
  activeBroker: BrokerAccount;
  connectedBrokers: BrokerAccount[];
  setActiveBroker: (id: string) => void;
  updateBrokerKeys: (id: string, patch: Partial<BrokerAccount>) => void;
  disconnectBroker: (id: string) => void;
};

const STORAGE_KEY = "viipers_broker_accounts";

const BrokerContext = createContext<BrokerContextValue | null>(null);

function defaultStoredState(): StoredBrokerState {
  return {
    apiKeySet: false,
    apiPassphraseSet: false,
    apiSecretSet: false,
    oauthConnected: false,
    status: "disconnected",
  };
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

/** Merge the code-owned catalog with persisted connection state. */
function hydrateBrokers(stored: StoredBrokerData): BrokerAccount[] {
  return BROKER_CATALOG.map((broker) => {
    const state = stored.brokers[broker.id];
    return {
      ...broker,
      ...defaultStoredState(),
      ...state,
      lastSync: state?.lastSync ? new Date(state.lastSync) : undefined,
    };
  });
}

function toStoredBrokers(
  brokers: BrokerAccount[],
): Record<string, StoredBrokerState> {
  const out: Record<string, StoredBrokerState> = {};
  for (const broker of brokers) {
    out[broker.id] = {
      accountId: broker.accountId,
      apiKeySet: broker.apiKeySet,
      apiPassphraseSet: broker.apiPassphraseSet,
      apiSecretSet: broker.apiSecretSet,
      balance: broker.balance,
      lastSync: broker.lastSync?.toISOString(),
      oauthConnected: broker.oauthConnected,
      status: broker.status,
    };
  }
  return out;
}

export function BrokerProvider({ children }: { children: ReactNode }) {
  const [brokers, setBrokers] = useState<BrokerAccount[]>(() =>
    hydrateBrokers({ activeBrokerId: null, brokers: {} }),
  );
  const [activeBrokerId, setActiveBrokerId] = useState<string | null>(null);

  // Hydrate from localStorage on mount (SSR-safe: storage is only touched
  // in effects, so server and first client render match).
  useEffect(() => {
    const stored = readStoredData();
    setBrokers(hydrateBrokers(stored));
    setActiveBrokerId(stored.activeBrokerId);
  }, []);

  // Single writer: every state change re-persists the derived blob.
  useEffect(() => {
    writeStoredData({
      activeBrokerId,
      brokers: toStoredBrokers(brokers),
    });
  }, [brokers, activeBrokerId]);

  const setActiveBroker = useCallback((id: string) => {
    setActiveBrokerId(id);
  }, []);

  const updateBrokerKeys = useCallback(
    (id: string, patch: Partial<BrokerAccount>) => {
      setBrokers((prev) =>
        prev.map((broker) =>
          broker.id === id ? { ...broker, ...patch } : broker,
        ),
      );
    },
    [],
  );

  const disconnectBroker = useCallback((id: string) => {
    setBrokers((prev) =>
      prev.map((broker) =>
        broker.id === id
          ? {
              ...broker,
              ...defaultStoredState(),
              accountId: undefined,
              balance: undefined,
              lastSync: undefined,
            }
          : broker,
      ),
    );
    setActiveBrokerId((current) => (current === id ? null : current));
  }, []);

  const connectedBrokers = useMemo(
    () => brokers.filter((broker) => broker.status === "connected"),
    [brokers],
  );

  const activeBroker = useMemo(() => {
    const byId = brokers.find((broker) => broker.id === activeBrokerId);
    return byId ?? connectedBrokers[0] ?? brokers[0];
  }, [brokers, activeBrokerId, connectedBrokers]);

  return (
    <BrokerContext.Provider
      value={{
        activeBroker,
        activeBrokerId,
        brokers,
        connectedBrokers,
        disconnectBroker,
        setActiveBroker,
        updateBrokerKeys,
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
