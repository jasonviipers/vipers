import "server-only";

import {
  type StrategyPluginManifest,
  validateStrategyPluginManifest,
} from "./plugin";
import { assertPluginSourceSafe } from "./plugin-boundary";
import {
  type PluginDecision,
  runIsolatedPluginSource,
  type StrategyEvidenceInput,
} from "./plugin-runtime";

/**
 * Strategy plugin registry — the only sanctioned way to execute plugin
 * source. Plugins are registered with their manifest and immutable source;
 * `runRegisteredStrategyPlugin` resolves the source FROM the registry by
 * pluginId + configHash, so a workflow can never execute source that was
 * not registered under the exact manifest hash it claims.
 *
 * Layers (in order):
 * 1. Registry binding: source is looked up by (pluginId, configHash) —
 *    callers pass identity, never source. (Also enforced by the immutable
 *    DB row in promotion-records.registerStrategyPlugin.)
 * 2. Static gate (second layer): registered source is re-checked with
 *    assertPluginSourceSafe at registration AND at every execution.
 * 3. Runtime isolation (the actual boundary): execution happens only via
 *    runIsolatedPluginSource → the worker realm with no require/import/
 *    process and no code generation (see plugin-worker.ts).
 *
 * This module holds the registry; it must never import broker, credential,
 * ledger, or db modules itself — the runtime's own cleanliness is part of
 * the boundary story. Registration persistence happens through the
 * caller-side hook so this file stays db-free.
 */

interface RegisteredPlugin {
  manifest: StrategyPluginManifest;
  registeredAt: string;
  source: string;
}

/** In-process registry; entries are immutable once registered. */
const registry = new Map<string, RegisteredPlugin>();

function registryKey(pluginId: string, configHash: string): string {
  return `${pluginId}@${configHash}`;
}

export interface RegisterPluginInput {
  /** Called once on first registration (e.g. persist the manifest row). */
  onFirstRegister?: (manifest: StrategyPluginManifest) => Promise<void>;
  source: string;
}

export async function registerStrategyPluginSource(
  input: RegisterPluginInput & { manifest: unknown },
): Promise<StrategyPluginManifest> {
  const manifest = validateStrategyPluginManifest(input.manifest);

  // Layer 2 (second layer, at registration): static import scan.
  assertPluginSourceSafe(input.source);

  const key = registryKey(manifest.pluginId, manifest.configHash);
  const existing = registry.get(key);
  if (existing) {
    if (existing.source !== input.source) {
      throw new Error(
        `plugin ${manifest.pluginId}@${manifest.configHash} is immutable; source differs from the registered version`,
      );
    }
    return existing.manifest;
  }

  if (input.onFirstRegister) {
    await input.onFirstRegister(manifest);
  }

  registry.set(key, {
    manifest,
    registeredAt: new Date().toISOString(),
    source: input.source,
  });
  return manifest;
}

/**
 * True when this exact (pluginId, configHash, source) triple is registered.
 * Defensive check for tests and callers that must not silently fall back to
 * unregistered execution.
 */
export function isPluginRegistered(
  pluginId: string,
  configHash: string,
  source: string,
): boolean {
  const registered = registry.get(registryKey(pluginId, configHash));
  return registered !== undefined && registered.source === source;
}

/**
 * Execute a registered plugin. The caller supplies the manifest claiming
 * pluginId + configHash; the source executed is always the REGISTERED
 * source for that pair — a caller-supplied `source` is ignored by design,
 * so workflow code cannot bypass the registry even accidentally.
 *
 * Throws when the manifest is malformed, the plugin is not registered
 * under that hash, or the isolated run fails the boundary checks.
 */
export async function runRegisteredStrategyPlugin(input: {
  evidence: StrategyEvidenceInput;
  input: Record<string, unknown>;
  manifest: unknown;
}): Promise<PluginDecision> {
  const manifest = validateStrategyPluginManifest(input.manifest);
  const registered = registry.get(
    registryKey(manifest.pluginId, manifest.configHash),
  );
  if (!registered) {
    throw new Error(
      `plugin ${manifest.pluginId}@${manifest.configHash} is not registered; register it with registerStrategyPluginSource before execution`,
    );
  }

  // Layer 2 (second layer, at execution): re-scan registered source so a
  // registration-time miss cannot survive to execution.
  assertPluginSourceSafe(registered.source);

  return runIsolatedPluginSource({
    evidence: input.evidence,
    input: input.input,
    manifest: registered.manifest,
    pluginId: manifest.pluginId,
    source: registered.source,
  });
}
