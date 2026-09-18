/**
 * Broker catalog the server-side routing actually enforces.
 *
 * Single source of truth for the things the trading pipeline and API
 * routes must agree on per broker:
 *  - which credential fields a broker requires (OKX needs a passphrase +
 *    region; Alpaca does not);
 *  - which symbols a broker can trade (an order for an unsupported asset
 *    fails closed at the router, never reaching the broker);
 *  - the instrument kinds each broker supports (OKX spot majors vs Alpaca
 *    crypto + US equities).
 *
 * The settings /settings UI mirrors this catalog client-side, but the
 * server never trusts the client: every route and the execution tool
 * resolve broker shape from here.
 */

export type BrokerId = "okx" | "alpaca";
type BrokerAccountType = "crypto" | "multi-asset" | "stocks";
type BrokerSymbolKind = "crypto" | "equity";
type BrokerRegion = "default" | "eea" | "us";

interface BrokerDefinition {
  accountType: BrokerAccountType;
  id: BrokerId;
  name: string;
  /**
   * Minimum API key/secret length accepted by the credentials route. OKX
   * keys are 16+ chars; Alpaca keys are long base64 blobs, so the same
   * floor is safe for both.
   */
  minKeyLength: number;
  regionOptions: readonly BrokerRegion[];
  requiresPassphrase: boolean;
  shortName: string;
  /** Symbols this broker can trade (base form, e.g. "BTC", "SPY"). */
  symbols: readonly string[];
  supportedKinds: readonly BrokerSymbolKind[];
}

/** Default broker for routing and the settings UI when nothing is selected yet. */
export const ACTIVE_BROKER_DEFAULT: BrokerId = "okx";

/** OKX spot majors — the sanctioned crypto universe for the OKX adapter. */
const OKX_CRYPTO_MAJORS = ["BTC", "DOGE", "ETH", "SOL", "XRP"] as const;

/** US equities the Alpaca adapter may trade. */
export const ALPACA_EQUITIES = ["AAPL", "NVDA", "SPY", "TSLA"] as const;

const BROKERS: Record<BrokerId, BrokerDefinition> = {
  alpaca: {
    accountType: "multi-asset",
    id: "alpaca",
    minKeyLength: 16,
    name: "Alpaca Markets",
    regionOptions: ["default"],
    requiresPassphrase: false,
    shortName: "ALPACA",
    supportedKinds: ["crypto", "equity"],
    symbols: [...OKX_CRYPTO_MAJORS, ...ALPACA_EQUITIES],
  },
  okx: {
    accountType: "crypto",
    id: "okx",
    minKeyLength: 16,
    name: "OKX",
    regionOptions: ["default", "eea", "us"],
    requiresPassphrase: true,
    shortName: "OKX",
    supportedKinds: ["crypto"],
    symbols: OKX_CRYPTO_MAJORS,
  },
};

export const BROKER_IDS = Object.keys(BROKERS) as BrokerId[];

export function isKnownBroker(id: string): id is BrokerId {
  return id === "okx" || id === "alpaca";
}

/** Resolve a broker definition; throws on unknown ids (never returns a partial shape). */
function brokerById(id: string): BrokerDefinition {
  if (!isKnownBroker(id)) {
    throw new Error(`Unknown broker: ${id}`);
  }
  return BROKERS[id];
}

/** Whether a broker's credential slots require a passphrase (OKX yes, Alpaca no). */
export function brokerRequiresPassphrase(brokerId: string): boolean {
  return brokerById(brokerId).requiresPassphrase;
}
