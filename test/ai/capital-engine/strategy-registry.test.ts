import { describe, expect, it } from "bun:test";

import {
  CONSENSUS_PLUGIN_FIXTURES,
  CONSENSUS_PLUGIN_MANIFEST,
  CONSENSUS_PLUGIN_SOURCE,
} from "@/ai/capital-engine/plugin-runtime";
import {
  isPluginRegistered,
  registerStrategyPluginSource,
  runRegisteredStrategyPlugin,
  verifyPluginFixtures,
} from "@/ai/capital-engine/strategy-registry";

/**
 * Registry gate: execution must resolve source FROM the registry by
 * (pluginId, configHash) — workflows pass identity, never source — and
 * registration must prove determinism by replaying the plugin's fixtures
 * through the real isolated runtime.
 */

const evidence = {
  asset: "BTC",
  signalFetchedAt: 1,
  signalId: "signal-1",
  technicalsFetchedAt: 2,
};

const candidate = {
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

function manifestWith(
  pluginId: string,
  configHash: string,
  pluginVersion = pluginId,
) {
  return { ...CONSENSUS_PLUGIN_MANIFEST, configHash, pluginId, pluginVersion };
}

/** Minimal valid fixture set for a passthrough-style plugin. */
function fixturesFor(pluginVersion: string) {
  const passThrough = {
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
    strategyVersion: pluginVersion,
  };
  return [
    {
      evidence,
      expectedDecision: passThrough,
      input: { candidate: passThrough },
      name: "passthrough",
    },
  ];
}

describe("strategy registry gate", () => {
  it("refuses to execute a plugin that was never registered", async () => {
    await expect(
      runRegisteredStrategyPlugin({
        evidence,
        input: { candidate },
        manifest: manifestWith("never-registered", "b".repeat(64)),
      }),
    ).rejects.toThrow("not registered");
  });

  it("registers and executes the consensus plugin through the isolated realm", async () => {
    await registerStrategyPluginSource({
      fixtures: CONSENSUS_PLUGIN_FIXTURES,
      manifest: CONSENSUS_PLUGIN_MANIFEST,
      source: CONSENSUS_PLUGIN_SOURCE,
    });
    expect(
      isPluginRegistered(
        "consensus-v1",
        CONSENSUS_PLUGIN_MANIFEST.configHash,
        CONSENSUS_PLUGIN_SOURCE,
      ),
    ).toBe(true);

    const decision = await runRegisteredStrategyPlugin({
      evidence,
      input: { candidate },
      manifest: CONSENSUS_PLUGIN_MANIFEST,
    });
    expect(decision).toMatchObject({
      asset: "BTC",
      direction: "LONG",
      strategyVersion: "consensus-v1",
    });
  });

  it("rejects registration without fixtures", async () => {
    await expect(
      registerStrategyPluginSource({
        fixtures: [],
        manifest: manifestWith("fixtureless-v1", "e".repeat(64)),
        source: CONSENSUS_PLUGIN_SOURCE,
      }),
    ).rejects.toThrow();
  });

  it("rejects a nondeterministic plugin (output drifts between runs)", async () => {
    // Time-of-run leaks into the decision → no run matches the recording.
    await expect(
      registerStrategyPluginSource({
        fixtures: fixturesFor("nondet-v1"),
        manifest: manifestWith("nondet-v1", "f".repeat(64)),
        source:
          "async ({ candidate }) => ({ ...candidate, reasoning: String(Date.now()) })",
      }),
      // Either failure mode is a correct rejection: the first run may not
      // match the recording, or repetitions may diverge among themselves.
    ).rejects.toThrow(/not deterministic|does not reproduce/);
  });

  it("rejects a plugin whose output is nondeterministic across repetitions", async () => {
    // First run defines the recording; later runs diverge → the repetition
    // check catches what a single-record comparison would miss.
    await expect(
      registerStrategyPluginSource({
        fixtures: fixturesFor("rep-diverge-v1"),
        manifest: manifestWith("rep-diverge-v1", "1".repeat(64)),
        source:
          "async ({ candidate }) => ({ ...candidate, reasoning: Math.random() < 0.5 ? 'a' : 'b' })",
      }),
    ).rejects.toThrow();
  });

  it("rejects fixtures whose recorded decision mismatches plugin behavior", async () => {
    const fixtures = fixturesFor("mismatch-v1");
    fixtures[0].expectedDecision = {
      ...fixtures[0].expectedDecision,
      confidence: 0.11,
    };
    await expect(
      registerStrategyPluginSource({
        fixtures,
        manifest: manifestWith("mismatch-v1", "2".repeat(64)),
        source: "async ({ candidate }) => candidate",
      }),
    ).rejects.toThrow("does not reproduce its recorded decision");
  });

  it("verifies fixtures on demand and detects drift after registration", async () => {
    const manifest = manifestWith("driftless-v1", "3".repeat(64));
    await registerStrategyPluginSource({
      fixtures: fixturesFor("driftless-v1"),
      manifest,
      source: "async ({ candidate }) => candidate",
    });
    // A registered, deterministic plugin re-verifies cleanly and echoes the
    // verified manifest identity (used by the promotion gate for lineage).
    const verified = await verifyPluginFixtures("driftless-v1", "3".repeat(64));
    expect(verified.pluginId).toBe("driftless-v1");
    expect(verified.pluginVersion).toBe("driftless-v1");
    // Version pinning: requesting a different version is refused.
    await expect(
      verifyPluginFixtures("driftless-v1", "3".repeat(64), "wrong-version"),
    ).rejects.toThrow("does not match the requested");
  });

  it("verifyPluginFixtures refuses unregistered plugins", async () => {
    await expect(
      verifyPluginFixtures("ghost-v1", "4".repeat(64)),
    ).rejects.toThrow("not registered");
  });

  it("rejects re-registering the same hash with different source (immutability)", async () => {
    await expect(
      registerStrategyPluginSource({
        fixtures: CONSENSUS_PLUGIN_FIXTURES,
        manifest: CONSENSUS_PLUGIN_MANIFEST,
        source: "async ({ candidate }) => ({ ...candidate, confidence: 1 })",
      }),
    ).rejects.toThrow("immutable");
  });

  it("static gate rejects registration of source importing broker modules", async () => {
    await expect(
      registerStrategyPluginSource({
        fixtures: CONSENSUS_PLUGIN_FIXTURES,
        manifest: manifestWith("evil-v1", "c".repeat(64)),
        source: 'import { placeOrder } from "@/channels/broker/adapter";',
      }),
    ).rejects.toThrow("forbidden modules");
  });

  it("runtime layer holds even when static scan AND fixtures are benign", async () => {
    // The decisive layered-defense case: the plugin behaves exactly as its
    // fixtures record for fixture inputs (so the determinism gate passes
    // and the static scan sees no forbidden pattern) but smuggles a module
    // import through an input path the fixtures do not cover. Only the
    // runtime realm can deny this.
    const source =
      "async ({ candidate, smuggle }) => { if (smuggle === 'node:fs') { return ((()=>require)())('node:fs'); } return candidate; }";
    const sneakyCandidate = { ...candidate, strategyVersion: "sneaky-v2" };
    const fixtures = [
      {
        evidence,
        expectedDecision: sneakyCandidate,
        input: { candidate: sneakyCandidate },
        name: "benign-path",
      },
    ];
    await registerStrategyPluginSource({
      fixtures,
      manifest: manifestWith("sneaky-v2", "d".repeat(64)),
      source,
    });
    expect(isPluginRegistered("sneaky-v2", "d".repeat(64), source)).toBe(true);

    await expect(
      runRegisteredStrategyPlugin({
        evidence,
        input: { candidate: sneakyCandidate, smuggle: "node:fs" },
        manifest: manifestWith("sneaky-v2", "d".repeat(64)),
      }),
    ).rejects.toThrow("isolated plugin execution failed");
  });
});
