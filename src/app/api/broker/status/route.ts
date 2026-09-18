import {
  BROKER_IDS,
  type BrokerId,
  brokerRequiresPassphrase,
} from "@/channels/broker/registry";
import {
  getBrokerCredentialSlots,
  getBrokerCredentials,
} from "@/lib/broker-credentials";
import { checkBrokerHealth } from "@/lib/broker-health";
import { getLogger, withEvlog } from "@/lib/evlog";

export const dynamic = "force-dynamic";

/** Parse + validate the ?broker= query param; defaults to OKX when absent. */
function parseBrokerId(request: Request): BrokerId | null {
  const candidate = new URL(request.url).searchParams.get("broker");
  if (candidate === null) {
    return "okx";
  }
  return (BROKER_IDS as readonly string[]).includes(candidate)
    ? (candidate as BrokerId)
    : null;
}

/**
 * GET /api/broker/status?broker=okx|alpaca — server-owned broker connection
 * state.
 *
 * Single source of truth for the settings UI. Broker credentials are
 * entered in the /settings UI and stored server-side (encrypted at rest);
 * there is no env-var setup step. The route mirrors the execution tool's
 * routing rule exactly so the UI can never disagree with where orders
 * actually go.
 *
 * Read-only derivation; no secrets returned — only booleans and the
 * routing mode.
 */
export const GET = withEvlog(async (request: Request) => {
  const logger = getLogger();
  logger.set({ integration: "broker" });

  const brokerId = parseBrokerId(request);
  if (!brokerId) {
    return Response.json(
      { error: `unknown broker: expected ${BROKER_IDS.join(" or ")}` },
      { status: 400 },
    );
  }
  logger.set({ brokerId });

  // Stored credentials, per-mode slot presence (demo AND live setups, side
  // by side) plus which slot orders currently route through, and the active
  // credential probe (cached 5 min OK / 30 s fail, deduped): stored fields
  // say "configured", only a live call says "authenticated". Failures come
  // back with the broker error code + fix hint so the UI can warn precisely.
  const [stored, slots, health] = await Promise.all([
    getBrokerCredentials(brokerId),
    getBrokerCredentialSlots(brokerId),
    checkBrokerHealth(brokerId),
  ]);
  const requiresPassphrase = brokerRequiresPassphrase(brokerId);
  const response = {
    auth: health,
    credentials: {
      apiKey: stored !== null,
      passphrase: stored !== null && stored.passphrase !== undefined,
      secret: stored !== null,
    },
    id: brokerId,
    // "demo" → paper endpoints (OKX demo note: paper book; Alpaca paper
    // API). "live" is real capital; that distinction matters.
    mode: stored?.mode === "live" ? ("live" as const) : ("paper" as const),
    // Per-mode slot presence: the UI renders both setups and the switch
    // from this, so the panel can never disagree with what is routable.
    slots: slots ?? {
      demo: {
        apiKeySet: false,
        passphraseSet: false,
        secretSet: false,
      },
      live: {
        apiKeySet: false,
        passphraseSet: false,
        secretSet: false,
      },
    },
    // Brokers without a passphrase never store one; the field is reported
    // so consumers can render it conditionally.
    requiresPassphrase,
    region: stored?.region ?? "default",
  };

  logger.set({ mode: response.mode });
  return Response.json(response);
});
