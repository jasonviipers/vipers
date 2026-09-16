import { getBrokerCredentials } from "@/lib/broker-credentials";
import { type BrokerHealth, checkBrokerHealth } from "@/lib/broker-health";
import { useLogger, withEvlog } from "@/lib/evlog";

export const dynamic = "force-dynamic";

/**
 * GET /api/broker/status — server-owned broker connection state.
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
export const GET = withEvlog(async () => {
  const logger = useLogger();
  logger.set({ integration: "broker" });

  const stored = await getBrokerCredentials("okx");
  // Active credential probe (cached 5 min OK / 30 s fail, deduped): stored
  // fields say "configured", only a live call says "authenticated". Failures
  // come back with the OKX code + fix hint so the UI can warn precisely.
  const health: BrokerHealth = await checkBrokerHealth("okx");
  const response = stored
    ? {
        auth: health,
        credentials: {
          apiKey: true,
          passphrase: true,
          secret: true,
        },
        id: "okx",
        // "demo" → paper endpoints + x-simulated-trading. "live" is real
        // capital; that distinction matters.
        mode: stored.mode === "live" ? ("live" as const) : ("paper" as const),
        region: stored.region,
      }
    : {
        auth: health,
        credentials: { apiKey: false, passphrase: false, secret: false },
        id: "okx",
        mode: "paper" as const,
        region: "default" as const,
      };

  logger.set({ mode: response.mode });
  return Response.json(response);
});
