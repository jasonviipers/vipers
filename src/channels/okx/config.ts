import { getBrokerCredentials } from "@/lib/broker-credentials";

import type { OKXConfig } from "./types";

/**
 * Build OKX configuration from the server-side credential store
 * (broker_credentials table, written by the /settings UI — see
 * PUT /api/broker/credentials).
 *
 * Region determines the REST + WebSocket domains per OKX's regional
 * requirements. An API key is only valid against the region where its
 * account is registered — calling from another region's domain returns
 * "50119 API key doesn't exist" (OKX API FAQ):
 *   - "default" → www.okx.com       / ws.okx.com   (accounts on www.okx.com)
 *   - "eea"     → eea.okx.com       / wseea.okx.com (EU, my.okx.com accounts)
 *   - "us"      → us.okx.com        / wsus.okx.com  (US & AU, app.okx.com accounts)
 *
 * Demo mode keeps the region's REST host and adds the `x-simulated-trading:
 * 1` header via {@link authHeaders} — per OKX, demo REST requests reuse the
 * region's live host. Only WebSocket moves to a paper host (wspap/wseeapap),
 * and demo keys are separate from production keys: a demo key never works
 * without the header, a live key never works with it.
 *
 * When no credentials are stored the functions throw — callers (execution
 * tool) must check isBrokerConfigured() first and fall back to the paper
 * stub.
 */

const REGION_ENDPOINTS = {
  default: {
    rest: "https://www.okx.com",
    ws: "wss://ws.okx.com:8443/ws/v5",
    wsDemo: "wss://wspap.okx.com:8443/ws/v5",
  },
  eea: {
    rest: "https://eea.okx.com",
    ws: "wss://wseea.okx.com:8443/ws/v5",
    wsDemo: "wss://wseeapap.okx.com:8443/ws/v5",
  },
  us: {
    rest: "https://us.okx.com",
    ws: "wss://wsus.okx.com:8443/ws/v5",
    wsDemo: "wss://wsuspap.okx.com:8443/ws/v5",
  },
} as const;

export const OKX_BROKER_ID = "okx";

export async function getOKXCredentials(): Promise<{
  apiKey: string;
  passphrase: string;
  secretKey: string;
}> {
  const creds = await getBrokerCredentials(OKX_BROKER_ID);
  if (!creds) {
    throw new Error(
      "OKX is not configured: no credentials stored. " +
        "Add them in /settings → BROKER ACCOUNTS, or keep the broker unset to use the paper stub.",
    );
  }
  return {
    apiKey: creds.apiKey,
    passphrase: creds.passphrase,
    secretKey: creds.secret,
  };
}

export async function createOKXConfig(): Promise<OKXConfig> {
  const credentials = await getOKXCredentials();
  const stored = await getBrokerCredentials(OKX_BROKER_ID);
  // Region applies in BOTH modes: the key only exists on its registered
  // region's domain (see 50119 note above).
  const endpoints =
    REGION_ENDPOINTS[stored?.region ?? "default"] ?? REGION_ENDPOINTS.default;
  if (stored?.mode === "live") {
    return {
      ...credentials,
      restBaseUrl: endpoints.rest,
      simulated: false,
      wsBaseUrl: endpoints.ws,
    };
  }
  // Demo: REST stays on the region's host; authHeaders adds
  // x-simulated-trading: 1. WebSocket moves to the region's paper host.
  return {
    ...credentials,
    restBaseUrl: endpoints.rest,
    simulated: true,
    wsBaseUrl: endpoints.wsDemo,
  };
}
