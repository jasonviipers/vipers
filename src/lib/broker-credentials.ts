import { eq } from "drizzle-orm";

import { brokerRequiresPassphrase } from "@/channels/broker/registry";
import { db } from "@/db";
import { brokerCredentials } from "@/db/schema/trading";
import { log } from "@/lib/evlog";
import { openSecret, sealSecret } from "@/lib/secret-box";

/**
 * Server-side broker credential store — per-mode slots.
 *
 * Each broker row holds DEMO and LIVE credential slots. OKX demo and live
 * keys are DIFFERENT keys (a demo key never works on live endpoints and
 * vice versa), so each mode has its own encrypted slot. `activeMode`
 * selects which slot the trading pipeline reads:
 * getBrokerCredentials() returns the ACTIVE slot, so every consumer
 * (execution tool, broker config, health probe, balance sync) follows
 * the activation switch without code changes.
 *
 * Credential fields are broker-scoped (see src/channels/broker/registry.ts):
 * OKX requires a passphrase + region, Alpaca does not. passphrase is
 * therefore optional in the store — a broker that does not use it stores
 * an empty marker slot and never blocks on it.
 *
 * Activating a mode never touches the other slot's ciphertext —
 * switching demo → live → demo preserves both setups. The invariant
 * "the active slot is always populated" is enforced here: activation of
 * a slot with no stored credentials is refused.
 *
 * Plaintext never leaves the server: API surfaces return masked hints
 * and booleans only.
 */

const CACHE_TTL_MS = 30_000;

export type BrokerMode = "demo" | "live";

export interface BrokerCredentialSecret {
  apiKey: string;
  mode: BrokerMode;
  /** Empty/undefined for brokers that do not use a passphrase (Alpaca). */
  passphrase: string | undefined;
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

interface SlotColumns {
  apiKey: string | null;
  passphrase: string | null;
  secret: string | null;
}

function slotCiphers(
  row: typeof brokerCredentials.$inferSelect,
  slot: BrokerMode,
): SlotColumns {
  return slot === "live"
    ? {
        apiKey: row.apiKeyLiveCipher,
        passphrase: row.passphraseLiveCipher,
        secret: row.secretLiveCipher,
      }
    : {
        apiKey: row.apiKeyDemoCipher,
        passphrase: row.passphraseDemoCipher,
        secret: row.secretDemoCipher,
      };
}

function openSlot(
  ciphers: SlotColumns,
  requiresPassphrase: boolean,
): Pick<BrokerCredentialSecret, "apiKey" | "passphrase" | "secret"> | null {
  if (!ciphers.apiKey || !ciphers.secret) {
    return null;
  }
  const apiKey = openSecret(ciphers.apiKey);
  const secret = openSecret(ciphers.secret);
  if (!apiKey || !secret) {
    return null;
  }
  // The passphrase is only required for brokers that use one (OKX). Other
  // brokers store an empty marker cipher, so the slot is still usable.
  const passphrase = openSecret(ciphers.passphrase ?? "");
  if (requiresPassphrase && !passphrase) {
    return null;
  }
  return { apiKey, passphrase: passphrase || undefined, secret };
}

/**
 * Load the ACTIVE credential secret for a broker; null when not
 * configured (or when the active slot cannot be decrypted under the
 * current SECRET_BOX_KEY).
 */
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
      const mode: BrokerMode = row.activeMode === "live" ? "live" : "demo";
      const opened = openSlot(
        slotCiphers(row, mode),
        brokerRequiresPassphrase(brokerId),
      );
      if (opened) {
        value = {
          ...opened,
          mode,
          region:
            row.region === "eea" || row.region === "us"
              ? row.region
              : "default",
        };
      } else {
        log.warn({
          brokerId,
          message:
            "active broker credentials are unreadable under the current SECRET_BOX_KEY",
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
  mode: BrokerMode;
  /** Optional for brokers that do not use one; required for OKX. */
  passphrase?: string;
  region: "default" | "eea" | "us";
  secret: string;
}

/**
 * Save (and re-encrypt) ONE mode's credential slot. The other mode's
 * stored credentials are never touched — that is the property that lets
 * the operator add live credentials without killing the demo setup.
 *
 * Upserts the row when absent (demo default active), then makes the
 * saved slot ACTIVE: saving credentials for a mode is the natural
 * "connect this mode" action, and an empty slot cannot be activated.
 *
 * Brokers without a passphrase store an empty marker cipher in the
 * passphrase slot (NOT NULL constraint), so the row shape stays uniform.
 */
export async function saveBrokerCredentials(
  brokerId: string,
  input: SaveBrokerCredentialsInput,
): Promise<void> {
  const ciphers = {
    apiKey: sealSecret(input.apiKey.trim()),
    passphrase: sealSecret(input.passphrase?.trim() ?? ""),
    secret: sealSecret(input.secret.trim()),
  };

  const [existing] = await db
    .select({ id: brokerCredentials.id })
    .from(brokerCredentials)
    .where(eq(brokerCredentials.id, brokerId))
    .limit(1);

  if (!existing) {
    await db.insert(brokerCredentials).values({
      activeMode: input.mode,
      apiKeyDemoCipher: input.mode === "demo" ? ciphers.apiKey : sealSecret(""),
      apiKeyLiveCipher: input.mode === "live" ? ciphers.apiKey : null,
      id: brokerId,
      passphraseDemoCipher:
        input.mode === "demo" ? ciphers.passphrase : sealSecret(""),
      passphraseLiveCipher: input.mode === "live" ? ciphers.passphrase : null,
      region: input.region,
      secretDemoCipher: input.mode === "demo" ? ciphers.secret : sealSecret(""),
      secretLiveCipher: input.mode === "live" ? ciphers.secret : null,
      updatedAt: new Date(),
    });
  } else {
    await db
      .update(brokerCredentials)
      .set({
        ...(input.mode === "live"
          ? {
              activeMode: "live" as const,
              apiKeyLiveCipher: ciphers.apiKey,
              passphraseLiveCipher: ciphers.passphrase,
              secretLiveCipher: ciphers.secret,
            }
          : {
              apiKeyDemoCipher: ciphers.apiKey,
              passphraseDemoCipher: ciphers.passphrase,
              secretDemoCipher: ciphers.secret,
            }),
        region: input.region,
        updatedAt: new Date(),
      })
      .where(eq(brokerCredentials.id, brokerId));
  }
  invalidate(brokerId);
}

/** Remove ONE mode's credential slot (the other slot is untouched). */
export async function deleteBrokerCredentials(
  brokerId: string,
  mode?: BrokerMode,
): Promise<void> {
  if (mode === undefined) {
    // Full disconnect: remove the row entirely.
    await db
      .delete(brokerCredentials)
      .where(eq(brokerCredentials.id, brokerId));
    invalidate(brokerId);
    return;
  }

  const [row] = await db
    .select()
    .from(brokerCredentials)
    .where(eq(brokerCredentials.id, brokerId))
    .limit(1);
  if (!row) {
    invalidate(brokerId);
    return;
  }

  const activeMode: BrokerMode = row.activeMode === "live" ? "live" : "demo";
  if (activeMode === mode) {
    // Refuse to remove the ACTIVE slot's credentials: the invariant
    // "active slot is populated" must hold. Disconnect (no-mode delete)
    // or switch first.
    throw new Error(
      `cannot remove the active (${mode}) credentials; switch modes or disconnect the broker first`,
    );
  }

  await db
    .update(brokerCredentials)
    .set({
      apiKeyLiveCipher: mode === "live" ? null : row.apiKeyLiveCipher,
      passphraseLiveCipher: mode === "live" ? null : row.passphraseLiveCipher,
      secretLiveCipher: mode === "live" ? null : row.secretLiveCipher,
      ...(mode === "demo"
        ? {
            apiKeyDemoCipher: sealSecret(""),
            passphraseDemoCipher: sealSecret(""),
            secretDemoCipher: sealSecret(""),
          }
        : {}),
      updatedAt: new Date(),
    })
    .where(eq(brokerCredentials.id, brokerId));
  invalidate(brokerId);
}

export interface UpdateBrokerSettingsInput {
  mode?: BrokerMode;
  region?: "default" | "eea" | "us";
}

/**
 * Mode activation switch: makes `mode`'s stored credentials the ones the
 * trading pipeline reads. NEVER touches either slot's ciphertext —
 * switching demo → live → demo preserves both setups. Refused when the
 * target slot has no stored credentials (the inactive slot may be empty),
 * or when the row does not exist. Region updates stay allowed on either
 * mode.
 */
export async function updateBrokerSettings(
  brokerId: string,
  input: UpdateBrokerSettingsInput,
): Promise<void> {
  const [row] = await db
    .select()
    .from(brokerCredentials)
    .where(eq(brokerCredentials.id, brokerId))
    .limit(1);
  if (!row) {
    throw new Error("no credentials stored; save credentials first");
  }

  if (
    input.mode &&
    input.mode !== (row.activeMode === "live" ? "live" : "demo")
  ) {
    const target = slotCiphers(row, input.mode);
    const requiresPassphrase = brokerRequiresPassphrase(brokerId);
    if (
      !target.apiKey ||
      !target.secret ||
      (requiresPassphrase && !target.passphrase)
    ) {
      throw new Error(
        `no ${input.mode} credentials stored; save them before switching`,
      );
    }
  }

  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (input.mode) {
    set.activeMode = input.mode;
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

/** True when the broker has a usable, decryptable ACTIVE credential slot. */
export async function isBrokerConfigured(brokerId: string): Promise<boolean> {
  return (await getBrokerCredentials(brokerId)) !== null;
}

export interface BrokerSlotSummary {
  demo: { apiKeySet: boolean; passphraseSet: boolean; secretSet: boolean };
  live: { apiKeySet: boolean; passphraseSet: boolean; secretSet: boolean };
}

/**
 * Presence summary for BOTH mode slots (booleans only — no plaintext, no
 * hints). Lets the settings UI render demo and live setups side by side
 * and state exactly which mode is routable.
 */
export async function getBrokerCredentialSlots(
  brokerId: string,
): Promise<BrokerSlotSummary | null> {
  const [row] = await db
    .select()
    .from(brokerCredentials)
    .where(eq(brokerCredentials.id, brokerId))
    .limit(1);
  if (!row) {
    return null;
  }
  const summarize = (slot: BrokerMode) => {
    const ciphers = slotCiphers(row, slot);
    const requiresPassphrase = brokerRequiresPassphrase(brokerId);
    return {
      apiKeySet: Boolean(ciphers.apiKey),
      // Brokers without a passphrase always report it as a satisfied
      // field so the "complete" check in the UI does not block them.
      passphraseSet: requiresPassphrase ? Boolean(ciphers.passphrase) : true,
      secretSet: Boolean(ciphers.secret),
    };
  };
  return { demo: summarize("demo"), live: summarize("live") };
}
