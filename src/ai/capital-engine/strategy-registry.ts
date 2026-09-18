import "server-only";

import { canonicalise } from "./canonical-json";
import { validateCapitalDecision } from "./intent";
import {
  type StrategyPluginFixture,
  type StrategyPluginManifest,
  validateStrategyPluginFixtures,
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
  fixtures: StrategyPluginFixture[];
  manifest: StrategyPluginManifest;
  registeredAt: string;
  source: string;
}

/** In-process registry; entries are immutable once registered. */
const registry = new Map<string, RegisteredPlugin>();

/**
 * Registration-time determinism proof: every fixture is replayed N times
 * through the REAL isolated worker realm and must reproduce the recorded
 * decision byte-for-byte (canonical JSON equality) on every repetition.
 * This is what makes "deterministic fixtures" a gate rather than a label —
 * a plugin whose output drifts (time, randomness, identity smuggling) is
 * not registrable.
 */
const FIXTURE_REPETITIONS = 3;

async function assertFixturesDeterministic(
  pluginId: string,
  source: string,
  fixtures: StrategyPluginFixture[],
  pluginVersion: string,
): Promise<void> {
  for (const fixture of fixtures) {
    // The recording itself must be a well-formed decision that claims the
    // version being registered — a fixture bound to another version would
    // silently certify behavior this plugin version does not have.
    const recorded = validateCapitalDecision(fixture.expectedDecision);
    if (recorded.strategyVersion !== pluginVersion) {
      throw new Error(
        `plugin ${pluginId} fixture "${fixture.name}" records strategyVersion "${recorded.strategyVersion}", but the manifest registers "${pluginVersion}"`,
      );
    }
    let firstCanonical: string | undefined;
    for (let attempt = 0; attempt < FIXTURE_REPETITIONS; attempt++) {
      // Determinism runs are intentionally serial: parallel isolated-worker
      // executions could interleave worker-pool state, and the divergence
      // report needs stable repetition ordering. Three tiny runs —
      // parallelism is not a throughput concern here.
      // react-doctor-disable-next-line react-doctor/async-await-in-loop
      const decision = await runIsolatedPluginSource({
        evidence: fixture.evidence,
        input: fixture.input,
        manifest: { pluginVersion },
        pluginId,
        source,
      });
      const canonical = canonicalise(decision);
      if (firstCanonical === undefined) {
        firstCanonical = canonical;
      } else if (canonical !== firstCanonical) {
        throw new Error(
          `plugin ${pluginId} fixture "${fixture.name}" is not deterministic (repetition ${attempt + 1} diverged)`,
        );
      }
    }
    const expectedCanonical = canonicalise(recorded);
    if (firstCanonical !== expectedCanonical) {
      throw new Error(
        `plugin ${pluginId} fixture "${fixture.name}" does not reproduce its recorded decision`,
      );
    }
  }
}

function registryKey(pluginId: string, configHash: string): string {
  return `${pluginId}@${configHash}`;
}

export interface RegisterPluginInput {
  /**
   * Deterministic (input → expected decision) pairs covering the plugin's
   * behavior paths. Required: they are replayed through the isolated
   * runtime at registration, and registration fails if the plugin cannot
   * reproduce them exactly.
   */
  fixtures: unknown;
  /** Called once on first registration (e.g. persist the manifest row). */
  onFirstRegister?: (manifest: StrategyPluginManifest) => Promise<void>;
  source: string;
}

export async function registerStrategyPluginSource(
  input: RegisterPluginInput & { manifest: unknown },
): Promise<StrategyPluginManifest> {
  const manifest = validateStrategyPluginManifest(input.manifest);
  const fixtures = validateStrategyPluginFixtures(input.fixtures);

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

  // Determinism gate BEFORE the row is persisted: a plugin that cannot
  // reproduce its fixtures never reaches the registry or the DB.
  await assertFixturesDeterministic(
    manifest.pluginId,
    input.source,
    fixtures,
    manifest.pluginVersion,
  );

  if (input.onFirstRegister) {
    await input.onFirstRegister(manifest);
  }

  registry.set(key, {
    fixtures,
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
 * Drift check: re-run every registered fixture through the isolated realm
 * and confirm the plugin still decides byte-for-byte as at registration.
 * Called by the promotion gate before every stage advance (and usable on a
 * schedule) to detect runtime/environment changes that silently alter
 * plugin behavior. Pass expectedPluginVersion to refuse execution if the
 * registered version has moved since the caller last verified.
 *
 * Returns the registered manifest on success (so gated callers can echo
 * the exact verified identity into lineage records).
 */
export async function verifyPluginFixtures(
  pluginId: string,
  configHash: string,
  expectedPluginVersion?: string,
): Promise<StrategyPluginManifest> {
  const registered = registry.get(registryKey(pluginId, configHash));
  if (!registered) {
    throw new Error(
      `plugin ${pluginId}@${configHash} is not registered; nothing to verify`,
    );
  }
  if (
    expectedPluginVersion !== undefined &&
    registered.manifest.pluginVersion !== expectedPluginVersion
  ) {
    throw new Error(
      `plugin ${pluginId}@${configHash} registered version ${registered.manifest.pluginVersion} does not match the requested ${expectedPluginVersion}; re-register or correct the request`,
    );
  }
  await assertFixturesDeterministic(
    pluginId,
    registered.source,
    registered.fixtures,
    registered.manifest.pluginVersion,
  );
  return registered.manifest;
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
  /** Per-run budget override (ms), capped by the worker's hard ceiling. */
  budgetMs?: number;
  evidence: StrategyEvidenceInput;
  /** Per-run heap cap override (MB), capped by the worker's hard ceiling. */
  heapLimitMb?: number;
  input: Record<string, unknown>;
  manifest: unknown;
  /** Cancellation: aborting terminates the in-flight isolated run. */
  signal?: AbortSignal;
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
    budgetMs: input.budgetMs,
    evidence: input.evidence,
    heapLimitMb: input.heapLimitMb,
    input: input.input,
    manifest: registered.manifest,
    pluginId: manifest.pluginId,
    signal: input.signal,
    source: registered.source,
  });
}
