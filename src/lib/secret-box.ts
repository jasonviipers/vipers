/**
 * Secret box: symmetric encryption for secrets stored server-side in the
 * database (broker API credentials, LLM API keys).
 *
 * The key comes from SECRET_BOX_KEY (base64, 32 bytes → AES-256-GCM). In
 * development a deterministic fallback key is derived from DATABASE_URL so
 * a fresh clone works out of the box; production requires the real key so
 * encrypted credentials can never be silently protected by a public
 * fallback.
 *
 * Ciphertext format: `v1.<iv-b64>.<tag-b64>.<ciphertext-b64>`.
 */

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

const FALLBACK_SALT = "viipers-secret-box-v1";

let cachedKey: Buffer | null = null;

function loadKey(): Buffer {
  if (cachedKey) {
    return cachedKey;
  }
  const raw = process.env.SECRET_BOX_KEY?.trim();
  if (raw) {
    const key = Buffer.from(raw, "base64");
    if (key.length !== 32) {
      throw new Error(
        "SECRET_BOX_KEY must decode to exactly 32 bytes (generate with: openssl rand -base64 32)",
      );
    }
    cachedKey = key;
    return cachedKey;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "SECRET_BOX_KEY is required in production — stored broker/LLM credentials are encrypted with it",
    );
  }

  // Dev fallback: deterministic per-database, so secrets encrypted in one
  // environment stay decryptable there and nowhere else by accident.
  const dbUrl = process.env.DATABASE_URL ?? "local";
  cachedKey = createHash("sha256").update(`${FALLBACK_SALT}:${dbUrl}`).digest();
  return cachedKey;
}

/** Encrypt a UTF-8 string; returns the versioned ciphertext blob. */
export function sealSecret(plaintext: string): string {
  const key = loadKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    "v1",
    iv.toString("base64"),
    tag.toString("base64"),
    ciphertext.toString("base64"),
  ].join(".");
}

/** Decrypt a blob produced by sealSecret; null when tampered/unreadable. */
export function openSecret(blob: string): string | null {
  try {
    const [version, ivB64, tagB64, dataB64] = blob.split(".");
    if (version !== "v1" || !ivB64 || !tagB64 || !dataB64) {
      return null;
    }
    const key = loadKey();
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(ivB64, "base64"),
    );
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(dataB64, "base64")),
      decipher.final(),
    ]);
    return plaintext.toString("utf8");
  } catch {
    // Wrong key, tampered tag, or malformed blob — never throw to callers.
    return null;
  }
}

/** True when the ciphertext was produced under the current key. */
export function isSealedByCurrentKey(blob: string): boolean {
  return openSecret(blob) !== null;
}

/**
 * True when a value looks like plaintext (pre-migration row written by an
 * older build without encryption). Plaintext OKX keys start with patterned
 * prefixes; a v1 blob always starts with "v1.".
 */
export function looksPlaintext(value: string): boolean {
  return !value.startsWith("v1.");
}
