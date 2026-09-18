import { getBrokerCredentials } from "@/lib/broker-credentials";

import type { AlpacaConfig } from "./types";

/**
 * Build Alpaca API configuration from the server-side credential store
 * (broker_credentials table, written by the /settings UI).
 *
 * Alpaca keeps trading on two separate account families with their own
 * endpoints and their own API keys:
 *   - paper  → https://paper-api.alpaca.markets (simulated $)
 *   - live   → https://api.alpaca.markets       (real capital)
 * Market data is shared across both families on https://data.alpaca.markets
 * (the same keys authenticate it).
 *
 * The ACTIVE credential slot (getBrokerCredentials → activeMode) decides
 * paper vs live, mirroring the OKX demo/live switch. When no credentials
 * are stored the functions throw — callers (execution tool) must check
 * isBrokerConfigured() first and fall back to the paper book.
 */

export const ALPACA_BROKER_ID = "alpaca";

const ALPACA_ENDPOINTS = {
  live: {
    data: "https://data.alpaca.markets",
    rest: "https://api.alpaca.markets",
  },
  paper: {
    data: "https://data.alpaca.markets",
    rest: "https://paper-api.alpaca.markets",
  },
} as const;

async function getAlpacaCredentials(): Promise<{
  apiKeyId: string;
  secretKey: string;
}> {
  const creds = await getBrokerCredentials(ALPACA_BROKER_ID);
  if (!creds) {
    throw new Error(
      "Alpaca is not configured: no credentials stored. " +
        "Add them in /settings → BROKER ACCOUNTS, or keep the broker unset to use the paper stub.",
    );
  }
  return { apiKeyId: creds.apiKey, secretKey: creds.secret };
}

/** Build the effective Alpaca config for the ACTIVE credential slot. */
export async function createAlpacaConfig(): Promise<AlpacaConfig> {
  const { apiKeyId, secretKey } = await getAlpacaCredentials();
  const stored = await getBrokerCredentials(ALPACA_BROKER_ID);
  const mode = stored?.mode === "live" ? "live" : "paper";
  return {
    apiKeyId,
    dataBaseUrl: ALPACA_ENDPOINTS[mode].data,
    mode,
    restBaseUrl: ALPACA_ENDPOINTS[mode].rest,
    secretKey,
  };
}
