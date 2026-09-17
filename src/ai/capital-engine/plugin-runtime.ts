import {
  type CapitalIntent,
  type NoTradeDecision,
  validateCapitalDecision,
} from "./intent";
import type { StrategyPluginFixture, StrategyPluginManifest } from "./plugin";
import { runPluginSourceInIsolatedWorker } from "./plugin-worker";

export interface StrategyEvidenceInput {
  asset: string;
  signalFetchedAt: number;
  signalId: string;
  technicalsFetchedAt: number;
}

export type PluginDecision = CapitalIntent | NoTradeDecision;

export const CONSENSUS_PLUGIN_SOURCE = "async ({ candidate }) => candidate";

export const CONSENSUS_PLUGIN_MANIFEST: StrategyPluginManifest = {
  capabilities: ["proposal"],
  configHash: "0".repeat(64),
  evidenceRequirements: ["signal", "technicals"],
  pluginId: "consensus-v1",
  pluginVersion: "consensus-v1",
};

/** Shared evidence identity for the consensus plugin fixtures. */
const CONSENSUS_FIXTURE_EVIDENCE = {
  asset: "BTC",
  signalFetchedAt: 1_700_000_000_000,
  signalId: "fixture-signal-1",
  technicalsFetchedAt: 1_700_000_000_000,
} as const;

const consensusIntentCandidate = {
  asset: "BTC",
  confidence: 0.8,
  direction: "LONG",
  evidence: {
    signalFetchedAt: 1_700_000_000_000,
    signalId: "fixture-signal-1",
    technicalsFetchedAt: 1_700_000_000_000,
  },
  proposalId: "fixture-proposal-1",
  reasoning: "fixture evidence supports the proposal",
  signalId: "fixture-signal-1",
  strategyVersion: "consensus-v1",
} as const;

const consensusNoTradeCandidate = {
  asset: "BTC",
  confidence: 0.4,
  decision: "NO_TRADE",
  evidence: {
    signalFetchedAt: 1_700_000_000_000,
    signalId: "fixture-signal-1",
    technicalsFetchedAt: 1_700_000_000_000,
  },
  proposalId: "fixture-proposal-2",
  reason: "fixture evidence does not support a position",
  signalId: "fixture-signal-1",
  strategyVersion: "consensus-v1",
} as const;

/**
 * Deterministic fixtures for the consensus plugin — one per behavior
 * path: the intent passthrough and the NO_TRADE passthrough. The registry
 * replays these through the isolated worker at registration and on demand
 * (verifyPluginFixtures) to prove the plugin still decides identically.
 */
export const CONSENSUS_PLUGIN_FIXTURES: StrategyPluginFixture[] = [
  {
    evidence: CONSENSUS_FIXTURE_EVIDENCE,
    expectedDecision: consensusIntentCandidate,
    input: { candidate: consensusIntentCandidate },
    name: "intent-passthrough",
  },
  {
    evidence: CONSENSUS_FIXTURE_EVIDENCE,
    expectedDecision: consensusNoTradeCandidate,
    input: { candidate: consensusNoTradeCandidate },
    name: "no-trade-passthrough",
  },
];

/**
 * Run a registered plugin: source executes only in the isolated worker
 * realm (see plugin-worker.ts), and the result must re-validate against
 * the manifest/evidence identity host-side before it is trusted.
 */
export async function runIsolatedPluginSource(input: {
  /**
   * Per-run wall-clock budget override (ms), within the hard ceiling in
   * plugin-worker.ts. Optional — the default budget applies otherwise.
   */
  budgetMs?: number;
  evidence: StrategyEvidenceInput;
  /** Heap cap override (MB), within the hard ceiling in plugin-worker.ts. */
  heapLimitMb?: number;
  input: Record<string, unknown>;
  /** Only pluginVersion is consumed (decision identity check). */
  manifest: Pick<StrategyPluginManifest, "pluginVersion">;
  pluginId: string;
  /** Cancellation: aborting terminates the in-flight isolated run. */
  signal?: AbortSignal;
  source: string;
}): Promise<PluginDecision> {
  // No full-manifest re-parse here: full schema validation is the REGISTRY
  // entry's job (runRegisteredStrategyPlugin); this facade only consumes
  // pluginVersion for the decision identity check.
  const decision = validateCapitalDecision(
    await runPluginSourceInIsolatedWorker({
      budgetMs: input.budgetMs,
      heapLimitMb: input.heapLimitMb,
      input: input.input,
      signal: input.signal,
      source: input.source,
    }),
  );
  if (decision.strategyVersion !== input.manifest.pluginVersion) {
    throw new Error("plugin version mismatch");
  }
  if (
    decision.asset !== input.evidence.asset ||
    decision.signalId !== input.evidence.signalId
  ) {
    throw new Error("plugin evidence identity mismatch");
  }
  return decision;
}
