import { env } from "@/env";
import { useLogger, withEvlog } from "@/lib/evlog";

export const dynamic = "force-dynamic";

/**
 * GET /api/broker/status — server-owned broker connection state.
 *
 * Single source of truth for the settings UI. Broker credentials are
 * server-side env vars (OKX_API_KEY / OKX_SECRET / OKX_PASSPHRASE, with
 * OKX_DEMO for paper endpoints); there is no user-typed-key connection
 * flow. The route mirrors the execution tool's routing rule exactly so
 * the UI can never disagree with where orders actually go.
 *
 * Read-only derivation; no secrets returned — only booleans and the
 * routing mode.
 */
export const GET = withEvlog(async () => {
  const logger = useLogger();
  logger.set({ integration: "broker" });

  const okxConfigured = Boolean(
    env.OKX_API_KEY && env.OKX_SECRET && env.OKX_PASSPHRASE,
  );
  const demo = env.OKX_DEMO === "true";

  const response = okxConfigured
    ? {
        credentials: {
          apiKey: Boolean(env.OKX_API_KEY),
          passphrase: Boolean(env.OKX_PASSPHRASE),
          secret: Boolean(env.OKX_SECRET),
        },
        id: "okx",
        // True when OKX_DEMO=true → paper endpoints + x-simulated-trading.
        // Present-but-false is real capital; that distinction matters.
        mode: demo ? ("paper" as const) : ("live" as const),
      }
    : {
        credentials: { apiKey: false, passphrase: false, secret: false },
        id: "okx",
        mode: "paper" as const,
      };

  logger.set({ mode: response.mode });
  return Response.json(response);
});
