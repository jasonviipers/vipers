import { describe, expect, it, mock } from "bun:test";

/**
 * Decision metadata: every persisted decision must carry WHICH plugin
 * decided (id + version + config hash), WHICH model/provider produced the
 * reasoning, and the operator settings hash. The content hash must be
 * sensitive to all of them — two decisions differing only in deciding
 * artifact can never share an audit hash.
 */

// Settings access is mocked: the builder must omit settingsHash when the
// store is unreachable rather than record a placeholder.
mock.module("@/lib/runtime-settings", () => ({
  getRuntimeSettings: async () => {
    throw new Error("db unreachable");
  },
  hashRuntimeSettings: async () => {
    throw new Error("db unreachable");
  },
}));

const { buildDecisionMetadata, hashDecision } = await import(
  "@/ai/audit/decision-snapshot"
);

function snapshotWith(metadata: Record<string, unknown>) {
  return {
    asset: "BTC",
    inputs: {
      consensus: {
        confidence: 0.8,
        direction: "LONG" as const,
        quorum: 50,
        votesAgainst: 0,
        votesFor: 1,
      },
      proposal: {
        agentId: "reasoning-analysis-agent",
        asset: "BTC",
        confidence: 0.8,
        direction: "LONG" as const,
        proposalId: "prp-1",
        reasoning: "r",
        signalId: "sig-1",
      },
      signal: {
        asset: "BTC",
        confidence: 0.8,
        fetchedAt: 1,
        highlights: [],
        sentimentBreakdown: { redditScore: 0, rssScore: 0 },
        sentimentSocialVolume: 0,
        sentimentSources: { reddit: 0, rss: 0 },
        signalId: "sig-1",
      },
      technicals: {
        fetchedAt: 2,
        patterns: [],
        regime: "trend",
        rsi: 50,
        trend: "up",
      },
    },
    metadata: metadata as never,
    outcome: {
      order: null,
      risk: { approved: true, positionSizePct: 2, reason: "within limits" },
    },
    proposalId: "prp-1",
    signalId: "sig-1",
  };
}

const baseMetadataInput = {
  correlationId: "wf:BTC:automation",
  dataTimestamps: [1, 2],
  modelInfo: { modelId: "gemini-flash-latest", provider: "GOOGLE" },
  plugin: {
    configHash: "a".repeat(64),
    id: "consensus-v1",
    version: "consensus-v1",
  },
};

describe("decision metadata", () => {
  it("stamps the deciding plugin identity, model, and provider", async () => {
    const metadata = await buildDecisionMetadata(baseMetadataInput);
    expect(metadata.pluginId).toBe("consensus-v1");
    expect(metadata.pluginVersion).toBe("consensus-v1");
    expect(metadata.pluginConfigHash).toBe("a".repeat(64));
    expect(metadata.model).toBe("gemini-flash-latest");
    expect(metadata.provider).toBe("GOOGLE");
    expect(metadata.correlationId).toBe("wf:BTC:automation");
    // Settings store unreachable in this test: omitted, not fabricated.
    expect(metadata.settingsHash).toBeUndefined();
  });

  it("content hash changes when the deciding plugin config hash changes", async () => {
    const metadataA = await buildDecisionMetadata(baseMetadataInput);
    const metadataB = await buildDecisionMetadata({
      ...baseMetadataInput,
      plugin: {
        ...baseMetadataInput.plugin,
        configHash: "b".repeat(64),
      },
    });
    const hashA = hashDecision(snapshotWith({ ...metadataA }));
    const hashB = hashDecision(snapshotWith({ ...metadataB }));
    expect(hashA).not.toBe(hashB);
  });

  it("content hash changes when the model/provider changes", async () => {
    const metadataA = await buildDecisionMetadata(baseMetadataInput);
    const metadataB = await buildDecisionMetadata({
      ...baseMetadataInput,
      modelInfo: { modelId: "gpt-4.1-mini", provider: "OPENAI" },
    });
    const hashA = hashDecision(snapshotWith({ ...metadataA }));
    const hashB = hashDecision(snapshotWith({ ...metadataB }));
    expect(hashA).not.toBe(hashB);
  });

  it("content hash changes when the plugin version changes", async () => {
    const metadataA = await buildDecisionMetadata(baseMetadataInput);
    const metadataB = await buildDecisionMetadata({
      ...baseMetadataInput,
      plugin: { ...baseMetadataInput.plugin, version: "consensus-v2" },
    });
    const hashA = hashDecision(snapshotWith({ ...metadataA }));
    const hashB = hashDecision(snapshotWith({ ...metadataB }));
    expect(hashA).not.toBe(hashB);
  });
});
