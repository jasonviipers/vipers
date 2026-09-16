import { describe, expect, it } from "bun:test";

import {
  advancePromotion,
  canAdvancePromotion,
} from "@/ai/capital-engine/promotion";

const record = {
  configHash: "config-hash",
  dataSnapshotIds: ["data-2027-01"],
  evaluatedAt: "2027-01-01T00:00:00.000Z",
  pluginId: "momentum",
  pluginVersion: "1.0.0",
  policyHash: "policy-v1",
  stage: "DRAFT" as const,
};

describe("promotion state machine", () => {
  it("allows only the next controlled stage", () => {
    expect(canAdvancePromotion("DRAFT", "BACKTEST")).toBe(true);
    expect(canAdvancePromotion("DRAFT", "LIVE")).toBe(false);
    expect(canAdvancePromotion("CANARY", "LIVE")).toBe(true);
  });

  it("advances with the evaluation metadata intact", () => {
    const next = advancePromotion(record, "BACKTEST");
    expect(next.stage).toBe("BACKTEST");
    expect(next.pluginVersion).toBe(record.pluginVersion);
    expect(next.configHash).toBe(record.configHash);
  });

  it("rejects skipping simulation and missing evidence", () => {
    expect(() => advancePromotion(record, "LIVE")).toThrow("Invalid promotion");
    expect(() =>
      advancePromotion({ ...record, dataSnapshotIds: [] }, "BACKTEST"),
    ).toThrow("metadata");
  });
});
