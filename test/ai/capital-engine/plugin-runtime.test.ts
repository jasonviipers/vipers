import { describe, expect, it } from "bun:test";

import {
  assertPluginSourceSafe,
  findForbiddenPluginImports,
} from "@/ai/capital-engine/plugin-boundary";
import {
  runIsolatedPluginSource,
  runIsolatedStrategyPlugin,
} from "@/ai/capital-engine/plugin-runtime";
import { assertIsolatedImportDenied } from "@/ai/capital-engine/plugin-worker";

const manifest = {
  capabilities: ["proposal"],
  configHash: "a".repeat(64),
  evidenceRequirements: ["signal", "technicals"],
  pluginId: "consensus-v1",
  pluginVersion: "consensus-v1",
};

const evidence = {
  asset: "BTC",
  signalFetchedAt: 1,
  signalId: "signal-1",
  technicalsFetchedAt: 2,
};

describe("strategy plugin runtime boundary", () => {
  it("accepts an evidence-bound intent and returns no broker capability", async () => {
    const decision = await runIsolatedPluginSource({
      evidence,
      input: {
        candidate: {
          asset: "BTC",
          confidence: 0.8,
          direction: "LONG",
          evidence,
          proposalId: "proposal-1",
          reasoning: "fixture evidence supports the proposal",
          signalId: "signal-1",
          strategyVersion: "consensus-v1",
        },
      },
      manifest,
      pluginId: "consensus-v1",
      source: "async ({ candidate }) => candidate",
    });

    expect(decision).toMatchObject({
      asset: "BTC",
      direction: "LONG",
      strategyVersion: "consensus-v1",
    });
  });

  it("rejects a plugin result that tries to change strategy identity", async () => {
    await expect(
      runIsolatedPluginSource({
        evidence,
        input: {
          candidate: {
            asset: "BTC",
            confidence: 0.8,
            direction: "LONG",
            evidence,
            proposalId: "proposal-1",
            reasoning: "invalid identity",
            signalId: "signal-1",
            strategyVersion: "attacker-version",
          },
        },
        manifest,
        pluginId: "consensus-v1",
        source: "async ({ candidate }) => candidate",
      }),
    ).rejects.toThrow("plugin version mismatch");
  });

  it("rejects forbidden imports in the static plugin boundary", () => {
    const source = 'import { placeOrder } from "@/channels/broker/adapter";';
    expect(findForbiddenPluginImports(source)).toEqual([
      "@/channels/broker/adapter",
    ]);
    expect(() => assertPluginSourceSafe(source)).toThrow("forbidden modules");
  });

  it("executes plugin source in the worker and denies a broker import attempt", async () => {
    await expect(
      runIsolatedPluginSource({
        evidence,
        input: { candidate: { asset: "BTC" } },
        manifest,
        pluginId: "consensus-v1",
        source: '({ candidate }) => require("@/channels/broker/adapter")',
      }),
    ).rejects.toThrow();
  });

  it("rejects a forbidden broker/ledger/network import attempt in the isolated worker", async () => {
    await expect(
      assertIsolatedImportDenied("@/channels/broker/adapter"),
    ).resolves.toBeUndefined();
    await expect(
      runIsolatedStrategyPlugin({
        decision: {
          asset: "BTC",
          confidence: 0.8,
          direction: "LONG",
          evidence: {
            signalId: "signal-1",
            signalFetchedAt: 1,
            technicalsFetchedAt: 2,
          },
          proposalId: "proposal-1",
          reasoning: "fixture evidence supports the proposal",
          signalId: "signal-1",
          strategyVersion: "consensus-v1",
        },
        evidence,
        manifest,
        pluginId: "untrusted-plugin",
      }),
    ).rejects.toThrow("not registered in the isolated worker");
  });

  it("rejects malformed output instead of coercing it", async () => {
    await expect(
      runIsolatedPluginSource({
        evidence,
        input: { candidate: { direction: "LONG", confidence: "0.8" } },
        manifest,
        pluginId: "consensus-v1",
        source: "async ({ candidate }) => candidate",
      }),
    ).rejects.toThrow();
  });
});
