import {
  type CapitalIntent,
  type NoTradeDecision,
  validateCapitalDecision,
} from "./intent";
import {
  runPluginSourceInIsolatedWorker,
  validateInIsolatedWorker,
} from "./plugin-worker";
import {
  type StrategyPluginManifest,
  validateStrategyPluginManifest,
} from "./plugin";

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

export async function runIsolatedPluginSource(input: {
  evidence: StrategyEvidenceInput;
  input: Record<string, unknown>;
  manifest: StrategyPluginManifest;
  pluginId: string;
  source: string;
}): Promise<PluginDecision> {
  const manifest = validateStrategyPluginManifest(input.manifest);
  const decision = await runPluginSourceInIsolatedWorker({
    evidence: input.evidence,
    input: input.input,
    manifest,
    pluginId: input.pluginId,
    source: input.source,
  });
  return validateCapitalDecision(decision);
}

export async function runIsolatedStrategyPlugin(input: {
  decision: PluginDecision;
  evidence: StrategyEvidenceInput;
  manifest: StrategyPluginManifest;
  pluginId: string;
}): Promise<PluginDecision> {
  const manifest = validateStrategyPluginManifest(input.manifest);
  return validateInIsolatedWorker({
    decision: input.decision,
    evidence: input.evidence,
    manifest,
    pluginId: input.pluginId,
  });
}
