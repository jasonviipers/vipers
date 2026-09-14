import { getBrokerCredentials } from "@/lib/broker-credentials";

import type { OKXConfig } from "./types";

/**
 * Build OKX configuration from the server-side credential store
 * (broker_credentials table, written by the /settings UI — see
 * PUT /api/broker/credentials).
 *
 * Region determines the REST + WebSocket domains per OKX's regional
 * requirements:
 *   - "default" → openapi.okx.com / ws.okx.com   (most users)
 *   - "eea"     → eea.okx.com      / wseea.okx.com (EU, my.okx.com accounts)
 *   - "us"      → us.okx.com       / wsus.okx.com  (US & AU, app.okx.com accounts)
 *
 * Demo mode ignores region and uses the paper endpoints
 * (openapi.okx.com + wspap.okx.com) with the `x-simulated-trading: 1`
 * header added by {@link authHeaders}. Demo keys never touch real funds.
 *
 * When no credentials are stored the functions throw — callers (execution
 * tool) must check isBrokerConfigured() first and fall back to the paper
 * stub.
 */

const REGION_ENDPOINTS = {
  default: {
    rest: "https://openapi.okx.com",
    ws: "wss://ws.okx.com:8443/ws/v5",
  },
  eea: {
    rest: "https://eea.okx.com",
    ws: "wss://wseea.okx.com:8443/ws/v5",
  },
  us: {
    rest: "https://us.okx.com",
    ws: "wss://wsus.okx.com:8443/ws/v5",
  },
} as const;

const DEMO_ENDPOINTS = {
  rest: "https://openapi.okx.com",
  ws: "wss://wspap.okx.com:8443/ws/v5",
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
  if (stored?.mode === "live") {
    const endpoints =
      REGION_ENDPOINTS[stored.region] ?? REGION_ENDPOINTS.default;
    return {
      ...credentials,
      restBaseUrl: endpoints.rest,
      simulated: false,
      wsBaseUrl: endpoints.ws,
    };
  }
  return {
    ...credentials,
    restBaseUrl: DEMO_ENDPOINTS.rest,
    simulated: true,
    wsBaseUrl: DEMO_ENDPOINTS.ws,
  };
}
