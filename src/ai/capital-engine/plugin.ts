import { z } from "zod";

export const strategyPluginManifestSchema = z.object({
  capabilities: z.array(z.string().min(1)).min(1),
  configHash: z.string().regex(/^[a-f0-9]{64}$/),
  evidenceRequirements: z.array(z.string().min(1)).min(1),
  pluginId: z.string().min(1).max(120),
  pluginVersion: z.string().min(1).max(80),
});

export type StrategyPluginManifest = z.infer<
  typeof strategyPluginManifestSchema
>;

export function validateStrategyPluginManifest(
  manifest: unknown,
): StrategyPluginManifest {
  return strategyPluginManifestSchema.parse(manifest);
}

/**
 * Deterministic fixture contract: one recorded (input, expected decision)
 * pair per plugin behavior path. Fixtures are the determinism gate for
 * registration (see strategy-registry.ts) — a plugin that cannot reproduce
 * its expected decisions through the isolated runtime, byte-for-byte under
 * canonical JSON equality, is not registrable.
 */
export const strategyPluginFixtureSchema = z.object({
  /** Named path this fixture pins (e.g. "intent-long", "abstain"). */
  name: z.string().min(1).max(80),
  /** Evidence identity bound into the decision (asset + signal ids). */
  evidence: z.object({
    asset: z.string().min(1),
    signalFetchedAt: z.number().finite(),
    signalId: z.string().min(1),
    technicalsFetchedAt: z.number().finite(),
  }),
  /** The full isolated-runtime input payload. */
  input: z.record(z.string(), z.unknown()),
  /** The exact decision the plugin must produce for this input. */
  expectedDecision: z.unknown(),
});

export type StrategyPluginFixture = z.infer<typeof strategyPluginFixtureSchema>;

export function validateStrategyPluginFixtures(
  fixtures: unknown,
): StrategyPluginFixture[] {
  const parsed = z.array(strategyPluginFixtureSchema).min(1).parse(fixtures);
  const names = new Set<string>();
  for (const fixture of parsed) {
    if (names.has(fixture.name)) {
      throw new Error(`duplicate fixture name: ${fixture.name}`);
    }
    names.add(fixture.name);
  }
  return parsed;
}
