import { describe, expect, it, mock } from "bun:test";

/**
 * Active-broker routing matrix — the single decision point the execution
 * tool uses to pick an execution path. The two invariants that matter:
 *
 *  1. OKX semantics are UNCHANGED (demo → local paper book, live → OKX live
 *     API, none → paper book in dev / blocked in production).
 *  2. Alpaca credentials of EITHER slot route to a real Alpaca API, and the
 *     persisted order mode is "live" even for the paper account, because
 *     the reconciliation job only processes mode==="live" rows.
 */

type Mode = "demo" | "live";
const modes: Record<string, Mode | undefined> = {};
let activeBrokerId = "okx";

mock.module("@/lib/broker-credentials", () => ({
  getBrokerCredentials: (brokerId: string) =>
    Promise.resolve(modes[brokerId] ? { mode: modes[brokerId] } : null),
}));

mock.module("@/lib/runtime-settings", () => ({
  getRuntimeSettings: () => Promise.resolve({ activeBrokerId }),
}));

const { resolveActiveBrokerRoute } = await import("@/ai/broker/broker-router");

function reset(): void {
  for (const key of Object.keys(modes)) {
    delete modes[key];
  }
  activeBrokerId = "okx";
}

describe("resolveActiveBrokerRoute — OKX (unchanged semantics)", () => {
  it("routes demo credentials to the local paper book", async () => {
    reset();
    modes.okx = "demo";
    const route = await resolveActiveBrokerRoute({ nodeEnvironment: "test" });
    expect(route).toEqual({
      brokerId: "okx",
      executionRoute: "paper",
      mode: "paper",
      status: "ok",
    });
  });

  it("routes live credentials to the OKX live API", async () => {
    reset();
    modes.okx = "live";
    const route = await resolveActiveBrokerRoute({ nodeEnvironment: "test" });
    expect(route).toEqual({
      brokerId: "okx",
      executionRoute: "live",
      mode: "live",
      status: "ok",
    });
  });

  it("falls back to the paper book with no credentials in development", async () => {
    reset();
    const route = await resolveActiveBrokerRoute({
      nodeEnvironment: "development",
    });
    expect(route).toEqual({
      brokerId: "okx",
      executionRoute: "paper",
      mode: "paper",
      status: "ok",
    });
  });

  it("blocks unconfigured OKX in production", async () => {
    reset();
    const route = await resolveActiveBrokerRoute({
      nodeEnvironment: "production",
    });
    expect(route).toEqual({ status: "blocked" });
  });
});

describe("resolveActiveBrokerRoute — Alpaca", () => {
  it("routes demo (paper-account) credentials to the Alpaca API as mode=live", async () => {
    reset();
    activeBrokerId = "alpaca";
    modes.alpaca = "demo";
    const route = await resolveActiveBrokerRoute({ nodeEnvironment: "test" });
    expect(route).toEqual({
      brokerId: "alpaca",
      executionRoute: "live",
      mode: "live",
      status: "ok",
    });
  });

  it("routes live credentials to the Alpaca API as mode=live", async () => {
    reset();
    activeBrokerId = "alpaca";
    modes.alpaca = "live";
    const route = await resolveActiveBrokerRoute({ nodeEnvironment: "test" });
    expect(route).toEqual({
      brokerId: "alpaca",
      executionRoute: "live",
      mode: "live",
      status: "ok",
    });
  });

  it("falls back to the paper book when Alpaca has no credentials in development", async () => {
    reset();
    activeBrokerId = "alpaca";
    const route = await resolveActiveBrokerRoute({
      nodeEnvironment: "development",
    });
    expect(route).toEqual({
      brokerId: "alpaca",
      executionRoute: "paper",
      mode: "paper",
      status: "ok",
    });
  });

  it("blocks unconfigured Alpaca in production", async () => {
    reset();
    activeBrokerId = "alpaca";
    const route = await resolveActiveBrokerRoute({
      nodeEnvironment: "production",
    });
    expect(route).toEqual({ status: "blocked" });
  });

  it("never reads Alpaca credentials while OKX is the active broker", async () => {
    reset();
    modes.alpaca = "live";
    const route = await resolveActiveBrokerRoute({ nodeEnvironment: "test" });
    // OKX is unconfigured → paper book, despite Alpaca being configured.
    expect(route).toEqual({
      brokerId: "okx",
      executionRoute: "paper",
      mode: "paper",
      status: "ok",
    });
  });
});

describe("resolveActiveBrokerRoute — unknown persisted broker id", () => {
  it("falls back to OKX routing", async () => {
    reset();
    activeBrokerId = "coinbase";
    modes.okx = "live";
    const route = await resolveActiveBrokerRoute({ nodeEnvironment: "test" });
    expect(route).toEqual({
      brokerId: "okx",
      executionRoute: "live",
      mode: "live",
      status: "ok",
    });
  });

  it("blocks in production when the fallback broker is unconfigured", async () => {
    reset();
    activeBrokerId = "coinbase";
    const route = await resolveActiveBrokerRoute({
      nodeEnvironment: "production",
    });
    expect(route).toEqual({ status: "blocked" });
  });
});
