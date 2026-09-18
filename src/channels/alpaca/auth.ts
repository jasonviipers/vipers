import "server-only";
import { randomUUID } from "node:crypto";

import type { AlpacaConfig } from "./types";

/**
 * Alpaca REST authentication.
 *
 * Trading and market-data requests are authenticated with two headers —
 * APCA-API-KEY-ID and APCA-API-SECRET-KEY — signed by nothing (Alpaca does
 * not use HMAC request signing). Credentials come from the server-side
 * store (DB, written via the /settings UI), so the config is resolved on
 * each call (30s TTL cache in the credential store).
 */

/** Header set for an already-resolved config (pure; used by the client). */
export function authHeadersFor(config: AlpacaConfig): Record<string, string> {
  return {
    "APCA-API-KEY-ID": config.apiKeyId,
    "APCA-API-SECRET-KEY": config.secretKey,
    "Content-Type": "application/json",
  };
}

/**
 * Generate a unique client order ID for idempotency. Fits Alpaca's
 * 48-character limit (alphanumeric only).
 */
export function generateAlpacaClOrdId(): string {
  return `vipa${randomUUID().replace(/-/g, "").slice(0, 40)}`;
}

/**
 * Derive a stable Alpaca client order ID from a proposal ID. Deterministic
 * per proposal, so a retry or crash-recovery re-send of the same proposal
 * hits the same order on the exchange (idempotent). Alpaca caps it at 48
 * chars and allows alphanumerics; hyphens/colons in raw IDs are stripped.
 */
export function deriveAlpacaClOrdId(proposalId: string): string {
  const sanitized = proposalId.replace(/[^0-9A-Za-z]/g, "").slice(0, 42);
  if (!sanitized) {
    return generateAlpacaClOrdId();
  }
  return `vipa${sanitized}`;
}
