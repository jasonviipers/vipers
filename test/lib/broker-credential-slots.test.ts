import { beforeEach, describe, expect, it, mock } from "bun:test";

/**
 * Per-mode broker credential slots.
 *
 * The properties under test are the ones that make "go live without
 * killing demo" SAFE:
 *  - saving one slot never mutates the other slot's ciphertext;
 *  - activation (mode switch) never mutates either slot's ciphertext;
 *  - activating an empty slot is refused;
 *  - removing the ACTIVE slot is refused; the inactive slot can be
 *    removed freely;
 *  - getBrokerCredentials always returns the ACTIVE slot.
 *
 * The DB layer is a stateful mock mirroring the real contract
 * (activeMode pointer + nullable live slot + non-null demo slot).
 * The REAL sealSecret/openSecret run (SECRET_BOX_KEY is the dev
 * fallback under bun test), so roundtrip through the actual crypto.
 */

type Row = typeof import("@/db/schema/trading").brokerCredentials.$inferSelect;

const rows = new Map<string, Row>();

// Real ciphertext (dev-fallback key under bun test): the seeded demo slot
// must actually decrypt, exactly like a row the app wrote.
const { sealSecret } = await import("@/lib/secret-box");

function seedRow(partial?: Partial<Row>): Row {
  const row: Row = {
    activeMode: "demo",
    apiKeyDemoCipher: sealSecret("demo-key-1234567890"),
    apiKeyLiveCipher: null,
    id: "okx",
    passphraseDemoCipher: sealSecret("demo-pass"),
    passphraseLiveCipher: null,
    region: "default",
    secretDemoCipher: sealSecret("demo-secret-12345678"),
    secretLiveCipher: null,
    updatedAt: new Date(),
    ...partial,
  };
  rows.set(row.id, row);
  return row;
}

function makeDb() {
  return {
    delete: () => ({
      where: async () => {
        // Caller filters by id via eq(); emulate single-id delete by
        // exposing the raw filter is overkill — tests only delete "okx".
        rows.delete("okx");
      },
    }),
    insert: () => ({
      values: async (v: Row) => {
        rows.set(v.id, { ...v });
      },
    }),
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => (rows.has("okx") ? [rows.get("okx")] : []),
        }),
      }),
    }),
    update: () => ({
      set: (patch: Partial<Row>) => ({
        where: async () => {
          const row = rows.get("okx");
          if (row) {
            Object.assign(row, patch);
          }
        },
      }),
    }),
  };
}

mock.module("@/db", () => ({ db: makeDb() }));

const {
  deleteBrokerCredentials,
  getBrokerCredentialSlots,
  getBrokerCredentials,
  saveBrokerCredentials,
  updateBrokerSettings,
} = await import("@/lib/broker-credentials");

const liveInput = {
  apiKey: "live-key-1234567890",
  mode: "live" as const,
  passphrase: "live-pass",
  region: "default" as const,
  secret: "live-secret-12345678",
};

beforeEach(() => {
  rows.clear();
  seedRow();
});

describe("per-mode credential slots", () => {
  it("saving live credentials preserves the demo slot's ciphertext and activates live", async () => {
    const before = rows.get("okx");
    await saveBrokerCredentials("okx", liveInput);
    const after = rows.get("okx");

    expect(after?.activeMode).toBe("live");
    expect(after?.apiKeyDemoCipher).toBe(before?.apiKeyDemoCipher);
    expect(after?.secretDemoCipher).toBe(before?.secretDemoCipher);
    expect(after?.passphraseDemoCipher).toBe(before?.passphraseDemoCipher);
    expect(after?.apiKeyLiveCipher).not.toBeNull();
  });

  it("activating a mode switches reads without touching either slot's ciphertext", async () => {
    await saveBrokerCredentials("okx", liveInput);
    const liveCiphers = {
      apiKey: rows.get("okx")?.apiKeyLiveCipher,
      passphrase: rows.get("okx")?.passphraseLiveCipher,
      secret: rows.get("okx")?.secretLiveCipher,
    };

    // Switch back to demo.
    await updateBrokerSettings("okx", { mode: "demo" });
    expect(rows.get("okx")?.apiKeyLiveCipher).toBe(liveCiphers.apiKey);
    expect((await getBrokerCredentials("okx"))?.mode).toBe("demo");

    // Switch to live again.
    await updateBrokerSettings("okx", { mode: "live" });
    expect(rows.get("okx")?.apiKeyLiveCipher).toBe(liveCiphers.apiKey);
    const creds = await getBrokerCredentials("okx");
    expect(creds?.mode).toBe("live");
    expect(creds?.apiKey).toBe(liveInput.apiKey);
  });

  it("refuses to activate a slot with no stored credentials", async () => {
    await expect(updateBrokerSettings("okx", { mode: "live" })).rejects.toThrow(
      "no live credentials stored",
    );
    // Demo remains active and untouched.
    expect(rows.get("okx")?.activeMode).toBe("demo");
  });

  it("refuses to remove the ACTIVE slot; removes the inactive slot freely", async () => {
    await saveBrokerCredentials("okx", liveInput);
    // Active is now live — removing it must fail…
    await expect(deleteBrokerCredentials("okx", "live")).rejects.toThrow(
      "cannot remove the active",
    );
    // …while removing demo succeeds and leaves live intact.
    await deleteBrokerCredentials("okx", "demo");
    const row = rows.get("okx");
    expect(row?.activeMode).toBe("live");
    expect(row?.apiKeyLiveCipher).not.toBeNull();
  });

  it("full disconnect removes the row; reads report not-configured", async () => {
    await saveBrokerCredentials("okx", liveInput);
    await deleteBrokerCredentials("okx");
    expect(rows.has("okx")).toBe(false);
    expect(await getBrokerCredentials("okx")).toBeNull();
    expect(await getBrokerCredentialSlots("okx")).toBeNull();
  });

  it("slot summary reports both modes' presence", async () => {
    let slots = await getBrokerCredentialSlots("okx");
    expect(slots?.demo.apiKeySet).toBe(true);
    expect(slots?.live.apiKeySet).toBe(false);

    await saveBrokerCredentials("okx", liveInput);
    slots = await getBrokerCredentialSlots("okx");
    expect(slots?.demo.apiKeySet).toBe(true);
    expect(slots?.live.apiKeySet).toBe(true);
  });

  it("first save with mode=live creates the row with live active", async () => {
    rows.clear();
    await saveBrokerCredentials("okx", liveInput);
    const row = rows.get("okx");
    expect(row?.activeMode).toBe("live");
    expect(row?.apiKeyLiveCipher).not.toBeNull();
    // Demo slot backfilled with sealed-empty markers (NOT NULL contract).
    expect(row?.apiKeyDemoCipher).not.toBeNull();
    // And the empty demo slot reads as not-configured when inactive…
    const creds = await getBrokerCredentials("okx");
    expect(creds?.mode).toBe("live");
  });
});
