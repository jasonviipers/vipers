import { describe, expect, it } from "bun:test";

import { validateStrategyPluginManifest } from "@/ai/capital-engine/plugin";

const valid = {
  capabilities: ["market-data", "proposal"],
  configHash: "a".repeat(64),
  evidenceRequirements: ["quote", "technicals"],
  pluginId: "momentum-v1",
  pluginVersion: "1.0.0",
};

describe("strategy plugin manifest", () => {
  it("accepts a versioned, content-addressed manifest", () => {
    expect(validateStrategyPluginManifest(valid)).toEqual(valid);
  });

  it("rejects manifests without a valid config hash", () => {
    expect(() =>
      validateStrategyPluginManifest({ ...valid, configHash: "mutable" }),
    ).toThrow();
  });
});
