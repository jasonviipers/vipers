import { beforeEach, describe, expect, it, mock } from "bun:test";

/**
 * Alpaca channel contracts that do not need a network:
 *  - auth headers are the Alpaca scheme (no HMAC signing);
 *  - client order ids are deterministic, alphanumeric, and fit Alpaca's
 *    48-char cap (they are the idempotency key for crash recovery);
 *  - the config resolves the paper vs live trade host from the stored
 *    credential slot, while market data always uses the shared data host.
 */

interface StoredCreds {
  apiKey: string;
  mode: "demo" | "live";
  secret: string;
}

let stored: StoredCreds | null = null;

mock.module("server-only", () => ({}));

mock.module("@/lib/broker-credentials", () => ({
  getBrokerCredentials: () => Promise.resolve(stored),
}));

const { authHeadersFor, deriveAlpacaClOrdId, generateAlpacaClOrdId } =
  await import("@/channels/alpaca/auth");
const { createAlpacaConfig } = await import("@/channels/alpaca/config");

beforeEach(() => {
  stored = null;
});

describe("Alpaca auth headers", () => {
  it("uses the APCA key/secret header scheme", () => {
    const headers = authHeadersFor({
      apiKeyId: "PKTEST",
      dataBaseUrl: "https://data.alpaca.markets",
      mode: "paper",
      restBaseUrl: "https://paper-api.alpaca.markets",
      secretKey: "secret-test",
    });
    expect(headers["APCA-API-KEY-ID"]).toBe("PKTEST");
    expect(headers["APCA-API-SECRET-KEY"]).toBe("secret-test");
    expect(headers["Content-Type"]).toBe("application/json");
  });
});

describe("Alpaca client order ids", () => {
  it("is deterministic per proposal id", () => {
    expect(deriveAlpacaClOrdId("prop-abc-123")).toBe(
      deriveAlpacaClOrdId("prop-abc-123"),
    );
  });

  it("differs across proposal ids", () => {
    expect(deriveAlpacaClOrdId("prop-abc-123")).not.toBe(
      deriveAlpacaClOrdId("prop-abc-124"),
    );
  });

  it("stays within Alpaca's 48-char alphanumeric limit", () => {
    const id = deriveAlpacaClOrdId(
      "proposal:00000000-1111-2222-3333-444444444444/extra",
    );
    expect(id.length).toBeLessThanOrEqual(48);
    expect(id).toMatch(/^[0-9A-Za-z]+$/);
    expect(id.startsWith("vipa")).toBe(true);
  });

  it("falls back to a generated id when the proposal id sanitizes to nothing", () => {
    const id = deriveAlpacaClOrdId("---://");
    expect(id.startsWith("vipa")).toBe(true);
    expect(id).toMatch(/^[0-9A-Za-z]+$/);
    expect(id.length).toBeLessThanOrEqual(48);
  });

  it("generates unique ids", () => {
    expect(generateAlpacaClOrdId()).not.toBe(generateAlpacaClOrdId());
  });
});

describe("Alpaca endpoint resolution", () => {
  it("uses the paper trade host for the demo slot and the shared data host", async () => {
    stored = { apiKey: "PKTEST", mode: "demo", secret: "s" };
    const config = await createAlpacaConfig();
    expect(config.restBaseUrl).toBe("https://paper-api.alpaca.markets");
    expect(config.dataBaseUrl).toBe("https://data.alpaca.markets");
    expect(config.mode).toBe("paper");
    expect(config.apiKeyId).toBe("PKTEST");
  });

  it("uses the live trade host for the live slot", async () => {
    stored = { apiKey: "PKLIVE", mode: "live", secret: "s" };
    const config = await createAlpacaConfig();
    expect(config.restBaseUrl).toBe("https://api.alpaca.markets");
    expect(config.mode).toBe("live");
  });

  it("throws when no credentials are stored", async () => {
    await expect(createAlpacaConfig()).rejects.toThrow("not configured");
  });
});
