import { beforeEach, describe, expect, it, mock } from "bun:test";

// Mock the broker modules BEFORE importing the graph under test. bun evaluates
// static imports before the module body runs, so a static `import` of
// broker-health here would pull in the real broker-balance/credentials chain
// (db → secret-box → server-only) and blow up. mock.module + `await import`
// keeps the real modules from ever loading.
let equityImpl: () => Promise<unknown>;
let storedMode: "demo" | "live" = "demo";

mock.module("@/lib/broker-balance", () => ({
  BrokerNotConfiguredError: class BrokerNotConfiguredError extends Error {
    constructor() {
      super("not configured");
      this.name = "BrokerNotConfiguredError";
    }
  },
  fetchBrokerEquity: () => equityImpl(),
  syncBrokerBalanceToLedger: () => Promise.resolve({}),
}));

mock.module("@/lib/broker-credentials", () => ({
  isBrokerConfigured: () => Promise.resolve(true),
  getBrokerCredentials: () =>
    Promise.resolve({
      apiKey: "k",
      mode: storedMode,
      passphrase: "p",
      region: "default",
      secret: "s",
    }),
}));

const { OKXApiError } = await import("@/channels/okx/client");
const { checkBrokerHealth, resetBrokerHealthCache } = await import(
  "@/lib/broker-health"
);

function reset(impl: () => Promise<unknown>) {
  equityImpl = impl;
  storedMode = "demo";
  resetBrokerHealthCache();
}

describe("checkBrokerHealth", () => {
  beforeEach(() => {
    reset(() => Promise.resolve({ equityUsd: 1, mode: "demo" }));
  });

  it("is healthy when the equity probe succeeds", async () => {
    const health = await checkBrokerHealth("okx");
    expect(health.healthy).toBe(true);
    expect(health.hint).toBeUndefined();
    expect(health.okxCode).toBeUndefined();
  });

  it("classifies 50113 invalid sign with a re-save hint", async () => {
    reset(() =>
      Promise.reject(new OKXApiError("50113", "Invalid Sign", "/api/v5/x")),
    );
    const health = await checkBrokerHealth("okx");
    expect(health.healthy).toBe(false);
    expect(health.okxCode).toBe("50113");
    expect(health.hint).toContain("secret");
    expect(health.hint).toContain("re-save");
  });

  it("classifies 50119 unknown key with a region hint", async () => {
    reset(() =>
      Promise.reject(new OKXApiError("50119", "API key doesn't exist", "/x")),
    );
    const health = await checkBrokerHealth("okx");
    expect(health.healthy).toBe(false);
    expect(health.okxCode).toBe("50119");
    expect(health.hint).toContain("region");
  });

  it("has no okxCode for non-OKX transport errors", async () => {
    reset(() => Promise.reject(new Error("fetch failed")));
    const health = await checkBrokerHealth("okx");
    expect(health.healthy).toBe(false);
    expect(health.okxCode).toBeUndefined();
    expect(health.reason).toBe("fetch failed");
  });

  it("caches results within the TTL window", async () => {
    let calls = 0;
    reset(() => {
      calls += 1;
      return Promise.resolve({ equityUsd: 1, mode: "demo" });
    });
    await checkBrokerHealth("okx");
    await checkBrokerHealth("okx");
    await checkBrokerHealth("okx");
    expect(calls).toBe(1);
  });

  it("caches failures with the shortened TTL", async () => {
    let calls = 0;
    reset(() => {
      calls += 1;
      return Promise.reject(new OKXApiError("50113", "Invalid Sign", "/x"));
    });
    await checkBrokerHealth("okx");
    await checkBrokerHealth("okx");
    expect(calls).toBe(1);
    expect((await checkBrokerHealth("okx")).okxCode).toBe("50113");
  });

  it("hints a demo→real key swap for 50101 in demo mode", async () => {
    reset(() =>
      Promise.reject(
        new OKXApiError(
          "50101",
          "APIKey does not match current environment",
          "/x",
        ),
      ),
    );
    storedMode = "demo";
    const health = await checkBrokerHealth("okx");
    expect(health.healthy).toBe(false);
    expect(health.okxCode).toBe("50101");
    expect(health.hint).toContain("DEMO");
    expect(health.hint).toContain("Demo Trading");
  });

  it("hints a mode switch for 50101 in live mode", async () => {
    reset(() =>
      Promise.reject(
        new OKXApiError(
          "50101",
          "APIKey does not match current environment",
          "/x",
        ),
      ),
    );
    storedMode = "live";
    const health = await checkBrokerHealth("okx");
    expect(health.okxCode).toBe("50101");
    expect(health.hint).toContain("LIVE");
    expect(health.hint).toContain("DEMO");
  });
});
