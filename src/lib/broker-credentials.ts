import { eq } from "drizzle-orm";

import { db } from "@/db";
import { brokerCredentials } from "@/db/schema/trading";
import { log } from "@/lib/evlog";
import { openSecret, sealSecret } from "@/lib/secret-box";

/**
 * Server-side broker credential store. Credentials are entered in the
 * /settings UI and stored encrypted at rest (AES-256-GCM, secret-box) in
 * the broker_credentials table. This replaces the old OKX_* environment
 * variables — brokers are now connected/disconnected entirely through the
 * UI, without a redeploy.
 *
 * Plaintext never leaves the server: API surfaces return masked hints and
 * booleans only.
 */

const CACHE_TTL_MS = 30_000;

export interface BrokerCredentialSecret {
  apiKey: string;
  mode: "demo" | "live";
  passphrase: string;
  region: "default" | "eea" | "us";
  secret: string;
}

interface CachedEntry {
  value: BrokerCredentialSecret | null;
  expiresAt: number;
}

const cache = new Map<string, CachedEntry>();

function invalidate(brokerId: string): void {
  cache.delete(brokerId);
}

/** Load the credential secret for a broker; null when not configured. */
export async function getBrokerCredentials(
  brokerId: string,
): Promise<BrokerCredentialSecret | null> {
  const cached = cache.get(brokerId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  let value: BrokerCredentialSecret | null = null;
  try {
    const [row] = await db
      .select()
      .from(brokerCredentials)
      .where(eq(brokerCredentials.id, brokerId))
      .limit(1);

    if (row) {
      const apiKey = openSecret(row.apiKeyCipher);
      const secret = openSecret(row.secretCipher);
      const passphrase = openSecret(row.passphraseCipher);
      if (apiKey && secret && passphrase) {
        value = {
          apiKey,
          mode: row.mode === "live" ? "live" : "demo",
          passphrase,
          region:
            row.region === "eea" || row.region === "us"
              ? row.region
              : "default",
          secret,
        };
      } else {
        log.warn({
          brokerId,
          message:
            "broker credentials are unreadable under the current SECRET_BOX_KEY",
        });
      }
    }
  } catch (error) {
    // DB unreachable: serve the last known value within the TTL window,
    // otherwise report not-configured (the routing falls back to paper).
    log.error(
      error instanceof Error
        ? error
        : new Error("broker credential lookup failed"),
    );
  }

  cache.set(brokerId, { expiresAt: Date.now() + CACHE_TTL_MS, value });
  return value;
}

export interface SaveBrokerCredentialsInput {
  apiKey: string;
  mode: "demo" | "live";
  passphrase: string;
  region: "default" | "eea" | "us";
  secret: string;
}

/** Upsert (and re-encrypt) the credential row for a broker. */
export async function saveBrokerCredentials(
  brokerId: string,
  input: SaveBrokerCredentialsInput,
): Promise<void> {
  await db
    .insert(brokerCredentials)
    .values({
      apiKeyCipher: sealSecret(input.apiKey.trim()),
      id: brokerId,
      mode: input.mode,
      passphraseCipher: sealSecret(input.passphrase.trim()),
      region: input.region,
      secretCipher: sealSecret(input.secret.trim()),
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      set: {
        apiKeyCipher: sealSecret(input.apiKey.trim()),
        mode: input.mode,
        passphraseCipher: sealSecret(input.passphrase.trim()),
        region: input.region,
        secretCipher: sealSecret(input.secret.trim()),
        updatedAt: new Date(),
      },
      target: brokerCredentials.id,
    });
  invalidate(brokerId);
}

/** Remove the credential row (disconnects the broker). */
export async function deleteBrokerCredentials(brokerId: string): Promise<void> {
  await db.delete(brokerCredentials).where(eq(brokerCredentials.id, brokerId));
  invalidate(brokerId);
}

export interface UpdateBrokerSettingsInput {
  mode?: "demo" | "live";
  region?: "default" | "eea" | "us";
}

/**
 * Update mode/region WITHOUT touching the stored secrets. Flipping the
 * execution environment (e.g. after OKX reports a 50101 key/environment
 * mismatch) must not require re-typing the API key, secret and passphrase —
 * those are never returned to the browser, so a mode-only switch is the
 * only one-click fix. No-op when the row does not exist.
 */
export async function updateBrokerSettings(
  brokerId: string,
  input: UpdateBrokerSettingsInput,
): Promise<void> {
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (input.mode) {
    set.mode = input.mode;
  }
  if (input.region) {
    set.region = input.region;
  }
  await db
    .update(brokerCredentials)
    .set(set)
    .where(eq(brokerCredentials.id, brokerId));
  invalidate(brokerId);
}

/** True when the broker has a usable, decryptable credential row. */
export async function isBrokerConfigured(brokerId: string): Promise<boolean> {
  return (await getBrokerCredentials(brokerId)) !== null;
}
