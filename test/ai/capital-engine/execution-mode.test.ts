import { describe, expect, it } from "bun:test";

import {
  assertExecutionRoute,
  resolveExecutionRoute,
} from "@/ai/capital-engine/execution-mode";

describe("execution mode separation", () => {
  it("routes demo credentials only to paper execution", () => {
    expect(
      resolveExecutionRoute({
        credentialMode: "demo",
        nodeEnvironment: "production",
      }),
    ).toBe("paper");
  });

  it("routes live credentials only to live execution", () => {
    expect(
      resolveExecutionRoute({
        credentialMode: "live",
        nodeEnvironment: "test",
      }),
    ).toBe("live");
    expect(() => assertExecutionRoute("paper", "live")).toThrow(
      "Execution mode mismatch",
    );
  });

  it("blocks unconfigured production execution", () => {
    expect(
      resolveExecutionRoute({
        credentialMode: null,
        nodeEnvironment: "production",
      }),
    ).toBe("blocked");
    expect(() => assertExecutionRoute("live", "blocked")).toThrow(
      "Execution route is blocked",
    );
  });
});
