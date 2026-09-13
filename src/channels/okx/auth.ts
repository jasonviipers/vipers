import { createHmac, randomUUID } from "node:crypto";

import { createOKXConfig } from "./config";

/**
 * OKX v5 REST authentication.
 *
 * The signature covers: timestamp + method (uppercase) + requestPath + body
 * encoded with HMAC SHA256 and base64-encoded. All private endpoints require
 * four headers: OK-ACCESS-KEY, OK-ACCESS-SIGN, OK-ACCESS-TIMESTAMP,
 * OK-ACCESS-PASSPHRASE.
 */

export function timestampMs(): string {
  return new Date().toISOString();
}

export function sign(
  timestamp: string,
  method: string,
  requestPath: string,
  body: string,
): string {
  const message = `${timestamp}${method.toUpperCase()}${requestPath}${body}`;
  return createHmac("sha256", createOKXConfig().secretKey)
    .update(message)
    .digest("base64");
}

export function authHeaders(
  method: string,
  requestPath: string,
  body = "",
): Record<string, string> {
  const config = createOKXConfig();
  const ts = timestampMs();
  const signature = sign(ts, method, requestPath, body);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "OK-ACCESS-KEY": config.apiKey,
    "OK-ACCESS-PASSPHRASE": config.passphrase,
    "OK-ACCESS-SIGN": signature,
    "OK-ACCESS-TIMESTAMP": ts,
  };

  if (config.simulated) {
    headers["x-simulated-trading"] = "1";
  }

  return headers;
}

/**
 * WebSocket login signature uses a different pre-hash string:
 * timestamp + "GET" + "/users/self/verify"
 */
export function wsSign(timestamp: string): string {
  const config = createOKXConfig();
  const message = `${timestamp}GET/users/self/verify`;
  return createHmac("sha256", config.secretKey)
    .update(message)
    .digest("base64");
}

/**
 * Generate a client order ID for idempotency. Alphanumeric only and fits
 * OKX's 32-char limit (docs: max 32 alphanumeric characters).
 */
export function generateClOrdId(): string {
  return `vips${randomUUID().replace(/-/g, "").slice(0, 28)}`;
}

/**
 * Derive a stable, OKX-compatible client order ID from a proposal ID.
 * clOrdId must be alphanumeric (case-sensitive) and max 32 chars, so the
 * raw ID (e.g. a UUID with hyphens) is sanitised and truncated. Keeping it
 * deterministic per proposal makes retries idempotent on the exchange.
 */
export function deriveClOrdId(proposalId: string): string {
  const sanitized = proposalId.replace(/[^0-9A-Za-z]/g, "").slice(0, 26);
  if (!sanitized) {
    return generateClOrdId();
  }
  return `vips${sanitized}`;
}
