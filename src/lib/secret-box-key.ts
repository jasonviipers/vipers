import * as z from "zod";

/**
 * Single source of truth for the SECRET_BOX_KEY format: base64 that
 * decodes to exactly 32 bytes (AES-256).
 *
 * Consumed by two places that must never disagree:
 *  - src/env.ts: schema validation — a present-but-invalid key fails the
 *    boot fast (instead of the old behavior: a raw 500 on the first
 *    credential save, which is how the invalid key surfaced);
 *  - src/lib/secret-box.ts loadKey(): the runtime decode.
 *
 * Absent/empty stays valid here — development derives a fallback key and
 * production enforces presence separately (see secret-box.ts).
 */
export function decodeSecretBoxKey(raw: string | undefined): Buffer | null {
  const trimmed = raw?.trim();
  if (!trimmed) {
    return null;
  }
  const key = Buffer.from(trimmed, "base64");
  return key.length === 32 ? key : null;
}

export const secretBoxKeySchema = z
  .string()
  .trim()
  .refine(
    (value) => decodeSecretBoxKey(value) !== null,
    "SECRET_BOX_KEY must be base64 encoding exactly 32 bytes (generate with: openssl rand -base64 32)",
  );
