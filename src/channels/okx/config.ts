import { env } from "@/env";
import type { OKXConfig } from "./types";

/**
 * Build OKX configuration from environment variables.
 *
 * Region determines the REST + WebSocket domains per OKX's regional
 * requirements:
 *   - "default" → openapi.okx.com / ws.okx.com   (most users)
 *   - "eea"     → eea.okx.com      / wseea.okx.com (EU, my.okx.com accounts)
 *   - "us"      → us.okx.com       / wsus.okx.com  (US & AU, app.okx.com accounts)
 *
 * Demo trading (OKX_DEMO=true) ignores region and uses the paper endpoints
 * (openapi.okx.com + wspap.okx.com) with the `x-simulated-trading: 1` header
 * added by {@link authHeaders}. Demo keys never touch real funds.
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

export function requireOKXCredentials(): {
  apiKey: string;
  passphrase: string;
  secretKey: string;
} {
  const { OKX_API_KEY, OKX_PASSPHRASE, OKX_SECRET } = env;
  const missing = [
    !OKX_API_KEY && "OKX_API_KEY",
    !OKX_PASSPHRASE && "OKX_PASSPHRASE",
    !OKX_SECRET && "OKX_SECRET",
  ].filter(Boolean);
  if (missing.length > 0) {
    throw new Error(
      `OKX is not configured: missing ${missing.join(", ")}. ` +
        "Set these environment variables or leave OKX credentials unset to keep using the paper stub.",
    );
  }
  return {
    apiKey: OKX_API_KEY as string,
    passphrase: OKX_PASSPHRASE as string,
    secretKey: OKX_SECRET as string,
  };
}

export function createOKXConfig(): OKXConfig {
  const credentials = requireOKXCredentials();
  const simulated = env.OKX_DEMO === "true";
  if (simulated) {
    return {
      ...credentials,
      restBaseUrl: DEMO_ENDPOINTS.rest,
      simulated: true,
      wsBaseUrl: DEMO_ENDPOINTS.ws,
    };
  }
  const region = env.OKX_REGION ?? "default";
  const endpoints = REGION_ENDPOINTS[region] ?? REGION_ENDPOINTS.default;
  return {
    ...credentials,
    restBaseUrl: endpoints.rest,
    simulated: false,
    wsBaseUrl: endpoints.ws,
  };
}
