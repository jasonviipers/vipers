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
