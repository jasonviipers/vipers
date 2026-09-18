import { AlpacaApiError } from "@/channels/alpaca/client";
import { ALPACA_BROKER_ID } from "@/channels/alpaca/config";
import type { BrokerId } from "@/channels/broker/registry";
import { OKXApiError } from "@/channels/okx/client";
import {
  BrokerNotConfiguredError,
  fetchBrokerEquity,
} from "@/lib/broker-balance";
import {
  getBrokerCredentials,
  isBrokerConfigured,
} from "@/lib/broker-credentials";
import { log } from "@/lib/evlog";

/**
 * Broker credential health.
 *
 * "Credentials stored" (all required fields present) says nothing about
 * whether they actually authenticate — an expired demo key, a mistyped
 * secret or a region mismatch all pass that check but fail on every API
 * call. This module actively probes the account endpoint of the ACTIVE
 * broker and classifies the failure so the UI can warn instead of silently
 * showing stale zeros.
 *
 * Results are cached per broker (5 min TTL, failure-shortened to 30 s) so
 * the /api/broker/status poll (30 s interval) never hammers the API.
 */

const HEALTH_OK_TTL_MS = 5 * 60 * 1000;
const HEALTH_FAIL_TTL_MS = 30 * 1000;

export interface BrokerHealth {
  checkedAt: string;
  /** Operator-facing fix hint; present only when healthy === false. */
  hint?: string;
  healthy: boolean;
  /** Broker error code when the probe failed (OKX code / Alpaca HTTP status). */
  okxCode?: string;
  reason?: string;
}

interface CacheEntry {
  expiresAt: number;
  value: BrokerHealth;
}

const cache = new Map<string, CacheEntry>();
/** Deduplicates concurrent probes for the same broker. */
const inFlight = new Map<string, Promise<BrokerHealth>>();

/** Auth-class OKX error codes → operator-facing fix hint. */
const OKX_AUTH_HINTS: Record<string, string> = {
  "50113":
    "INVALID SIGN — stored secret does not match this API key; re-save the credentials",
  "50119":
    "API key doesn't exist — wrong region selected or the key was deleted; verify region and re-save",
  "50111": "Invalid API key — re-create the key and re-save the credentials",
  "50112":
    "Invalid passphrase — re-enter the passphrase set when the key was created",
};

/**
 * 50101 is environment-specific: the key is valid but belongs to the OTHER
 * environment than the stored EXECUTION MODE requests. The fix depends on
 * which side is wrong, so the hint names the current mode and both paths.
 */
function environmentMismatchHint(mode: "demo" | "live"): string {
  return mode === "demo"
    ? "ENVIRONMENT MISMATCH — EXECUTION MODE is DEMO but this key belongs to a REAL account. If you meant to trade demo funds, create a key inside Demo Trading (my.okx.com → Demo Trading → Personal Center → Demo Trading API) and re-save; if this is your real key, switch EXECUTION MODE to LIVE."
    : "ENVIRONMENT MISMATCH — EXECUTION MODE is LIVE but this key belongs to a DEMO account. Switch EXECUTION MODE to DEMO, or create a real-account API key and re-save.";
}

/**
 * Probe the broker's authentication by reading its account equity.
 * Configured but failing credentials yield healthy:false with a hint;
 * unconfigured brokers yield healthy:false with no broker error (nothing
 * to authenticate).
 */
export async function checkBrokerHealth(
  brokerId: BrokerId = "okx",
): Promise<BrokerHealth> {
  const cached = cache.get(brokerId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }
  const running = inFlight.get(brokerId);
  if (running) {
    return running;
  }

  const probe = (async () => {
    let health: BrokerHealth;
    try {
      if (!(await isBrokerConfigured(brokerId))) {
        health = { checkedAt: new Date().toISOString(), healthy: false };
      } else {
        const equity = await fetchBrokerEquity(brokerId);
        health = {
          checkedAt: equity.updatedAt,
          healthy: true,
        };
      }
    } catch (error) {
      const okxCode =
        error instanceof OKXApiError
          ? error.code
          : error instanceof AlpacaApiError
            ? String(error.httpStatus)
            : undefined;
      const reason =
        error instanceof BrokerNotConfiguredError
          ? undefined
          : error instanceof Error
            ? error.message
            : "unknown error";
      let hint: string | undefined;
      if (brokerId === ALPACA_BROKER_ID) {
        // Alpaca signals auth problems with 401 (bad key/secret) or
        // 403 (forbidden on the endpoint/family); give one actionable hint.
        if (okxCode && ["401", "403"].includes(okxCode)) {
          hint =
            "Alpaca rejected the stored API key/secret — verify the paper/live credentials and re-save them";
        }
      } else if (okxCode === "50101") {
        // Mode-aware: the fix differs depending on which side is wrong.
        const stored = await getBrokerCredentials(brokerId).catch(() => null);
        hint = environmentMismatchHint(
          stored?.mode === "live" ? "live" : "demo",
        );
      } else if (okxCode) {
        hint = OKX_AUTH_HINTS[okxCode];
      }
      health = {
        checkedAt: new Date().toISOString(),
        healthy: false,
        okxCode,
        reason,
        ...(hint ? { hint } : {}),
      };
    }

    cache.set(brokerId, {
      expiresAt:
        Date.now() + (health.healthy ? HEALTH_OK_TTL_MS : HEALTH_FAIL_TTL_MS),
      value: health,
    });
    return health;
  })();

  inFlight.set(brokerId, probe);
  try {
    return await probe;
  } finally {
    inFlight.delete(brokerId);
  }
}

/**
 * One-shot startup probe for instrumentation. Never throws; logs a loud
 * warning when configured credentials fail authentication so a broken
 * connection is visible at boot instead of at the first failed order.
 */
export async function runStartupBrokerHealthCheck(): Promise<void> {
  try {
    const health = await checkBrokerHealth("okx");
    if (health.healthy) {
      log.info({
        audit: "broker_health_ok",
        brokerId: "okx",
        job: "startup-health-check",
      });
    } else if (health.okxCode) {
      log.warn({
        audit: "broker_health_auth_failed",
        brokerId: "okx",
        hint: health.hint,
        job: "startup-health-check",
        okxCode: health.okxCode,
      });
    } else {
      // Not configured (or a non-auth transport error) — normal for a
      // paper-book setup, so info, not warn.
      log.info({
        audit: "broker_health_not_configured",
        brokerId: "okx",
        job: "startup-health-check",
      });
    }
  } catch (error) {
    log.error(
      error instanceof Error
        ? error
        : new Error("startup broker health check failed"),
    );
  }
}

/** Test seam: clear cached health state. */
export function resetBrokerHealthCache(): void {
  cache.clear();
  inFlight.clear();
}

/**
 * Drop cached health for a broker after its credentials/settings change
 * (save, mode switch, delete). Without this the status endpoint would keep
 * reporting the pre-change verdict until the TTL expires.
 */
export function invalidateBrokerHealth(brokerId = "okx"): void {
  cache.delete(brokerId);
  inFlight.delete(brokerId);
}
