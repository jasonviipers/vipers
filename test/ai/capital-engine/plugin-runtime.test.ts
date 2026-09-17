import { beforeAll, describe, expect, it } from "bun:test";

import {
  assertPluginSourceSafe,
  findForbiddenPluginImports,
} from "@/ai/capital-engine/plugin-boundary";
import {
  CONSENSUS_PLUGIN_MANIFEST,
  runIsolatedPluginSource,
} from "@/ai/capital-engine/plugin-runtime";
import { PLUGIN_EXECUTION_BUDGET_MS } from "@/ai/capital-engine/plugin-worker";

/**
 * Adversarial suite: a malicious plugin actively attempts every escape we
 * know of. Each case must be DENIED at runtime (the run rejects), because
 * the isolation is structural — the worker realm has no require/import/
 * process and no code generation — not a string-matching convention.
 */

const manifest = CONSENSUS_PLUGIN_MANIFEST;

const evidence = {
  asset: "BTC",
  signalFetchedAt: 1,
  signalId: "signal-1",
  technicalsFetchedAt: 2,
};

const validCandidate = {
  asset: "BTC",
  confidence: 0.8,
  direction: "LONG",
  evidence: {
    signalFetchedAt: 1,
    signalId: "signal-1",
    technicalsFetchedAt: 2,
  },
  proposalId: "proposal-1",
  reasoning: "fixture evidence supports the proposal",
  signalId: "signal-1",
  strategyVersion: "consensus-v1",
};

const validInput = { candidate: validCandidate };

/** Every attack must make the run FAIL — never resolve to a decision. */
function expectIsolationViolation(source: string) {
  return expect(
    runIsolatedPluginSource({
      evidence,
      input: validInput,
      manifest,
      pluginId: "consensus-v1",
      source,
    }),
  ).rejects.toThrow();
}

/** The honest plugin must still work — isolation didn't break the contract. */
function runHonestPlugin() {
  return runIsolatedPluginSource({
    evidence,
    input: validInput,
    manifest,
    pluginId: "consensus-v1",
    source: "async ({ candidate }) => candidate",
  });
}

describe("adversarial plugin runtime boundary", () => {
  let workerProbeSucceeded = false;

  beforeAll(async () => {
    // Gate: the worker harness itself works before trusting any "deny"
    // result. If this fails, every attack "passing" is meaningless.
    const decision = await runHonestPlugin();
    workerProbeSucceeded = decision.asset === "BTC";
    expect(workerProbeSucceeded).toBe(true);
  });

  it("denies require() of the broker adapter", async () => {
    await expectIsolationViolation(
      'async () => require("@/channels/broker/adapter")',
    );
    await expectIsolationViolation('async () => require("node:fs")');
  });

  it("denies dynamic import() of broker/ledger/db modules", async () => {
    await expectIsolationViolation(
      'async () => await import("@/lib/promotion-records")',
    );
    await expectIsolationViolation('async () => await import("node:net")');
    await expectIsolationViolation('async () => await import("pg")');
  });

  it("denies eval and the Function-constructor escape", async () => {
    await expectIsolationViolation("async () => eval(\"require('fs')\")");
    await expectIsolationViolation(
      "async () => ({}).constructor.constructor('return require')()",
    );
  });

  it("denies process/env access", async () => {
    await expectIsolationViolation("async () => process.env");
    await expectIsolationViolation(
      "async () => globalThis.process?.version ?? (() => { throw new Error('no process') })()",
    );
  });

  it("denies filesystem and network reachability attempts", async () => {
    await expectIsolationViolation(
      'async () => (await import("node:fs")).readFileSync("/etc/passwd", "utf8")',
    );
    await expectIsolationViolation(
      'async () => (await import("node:http")).request({ host: "169.254.169.254" })',
    );
  });

  it("denies prototype-pollution escape attempts against the sandbox", async () => {
    await expectIsolationViolation(
      "async () => { const o = {}; o.__proto__.polluted = 1; return o.polluted }",
    );
    await expectIsolationViolation(
      "async ({ candidate }) => { candidate.__proto__.grant = 'root'; return candidate.grant }",
    );
  });

  it("denies globalThis traversal looking for host objects", async () => {
    await expectIsolationViolation(
      "async () => Object.getOwnPropertyNames(globalThis).filter(k => !['input','globalThis','eval','undefined','NaN','Infinity'].includes(k) && typeof globalThis[k] === 'function' && /require|process|Buffer|fetch/.test(k)).join(',') !== '' ? (() => { throw new Error('found host globals') })() : 'clean'",
    );
  });

  it("terminates a plugin that runs past the execution budget", async () => {
    // A runaway sync loop must be killed at the hard worker deadline, not
    // hang the pipeline or the suite forever. (bun's vm ignores the sync
    // timeout option, so worker.terminate() is the operative guard.)
    const started = Date.now();
    await expectIsolationViolation("async () => { for(;;){} }");
    const elapsedMs = Date.now() - started;
    expect(elapsedMs).toBeLessThan(PLUGIN_EXECUTION_BUDGET_MS + 2_000);
  }, 20_000);

  it("static boundary gate rejects forbidden imports as a second layer", () => {
    const source = 'import { placeOrder } from "@/channels/broker/adapter";';
    expect(findForbiddenPluginImports(source)).toEqual([
      "@/channels/broker/adapter",
    ]);
    expect(() => assertPluginSourceSafe(source)).toThrow("forbidden modules");
  });

  it("still runs an honest plugin after all attacks", async () => {
    const decision = await runHonestPlugin();
    expect(decision).toMatchObject({
      asset: "BTC",
      direction: "LONG",
      strategyVersion: "consensus-v1",
    });
  });
});
