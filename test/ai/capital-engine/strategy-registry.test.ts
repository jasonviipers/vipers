import { describe, expect, it } from "bun:test";

import {
  CONSENSUS_PLUGIN_MANIFEST,
  CONSENSUS_PLUGIN_SOURCE,
} from "@/ai/capital-engine/plugin-runtime";
import {
  isPluginRegistered,
  registerStrategyPluginSource,
  runRegisteredStrategyPlugin,
} from "@/ai/capital-engine/strategy-registry";

/**
 * Registry gate: execution must resolve source FROM the registry by
 * (pluginId, configHash) — workflows pass identity, never source — and the
 * runtime layer must hold even when the static scan is bypassed.
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

function manifestWith(pluginId: string, configHash: string) {
  return { ...CONSENSUS_PLUGIN_MANIFEST, configHash, pluginId };
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

  it("rejects re-registering the same hash with different source (immutability)", async () => {
    await expect(
      registerStrategyPluginSource({
        manifest: CONSENSUS_PLUGIN_MANIFEST,
        source: "async ({ candidate }) => ({ ...candidate, confidence: 1 })",
      }),
    ).rejects.toThrow("immutable");
  });

  it("static gate rejects registration of source importing broker modules", async () => {
    await expect(
      registerStrategyPluginSource({
        manifest: manifestWith("evil-v1", "c".repeat(64)),
        source: 'import { placeOrder } from "@/channels/broker/adapter";',
      }),
    ).rejects.toThrow("forbidden modules");
  });

  it("runtime layer holds even when the static scan is bypassed", async () => {
    // No `require(` substring and no import statement, so the static scan
    // passes — but the plugin still calls require at runtime. The worker
    // realm must deny it: this is the proof the runtime layer is the real
    // boundary and the static gate is only a convenience layer.
    const source = "async () => ((()=>require)())('node:fs')";
    await registerStrategyPluginSource({
      manifest: manifestWith("sneaky-v1", "d".repeat(64)),
      source,
    });
    expect(isPluginRegistered("sneaky-v1", "d".repeat(64), source)).toBe(true);

    await expect(
      runRegisteredStrategyPlugin({
        evidence,
        input: { candidate },
        manifest: manifestWith("sneaky-v1", "d".repeat(64)),
      }),
    ).rejects.toThrow("isolated plugin execution failed");
  });
});
