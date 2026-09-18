import { describe, expect, it } from "bun:test";

/**
 * Shadow mode (checklist §7 — "Run live-data shadow mode with zero
 * orders"): the workflow runs the FULL pipeline on live data for a plugin
 * whose lineage head is at SHADOW, persists the real risk evaluation as
 * SHADOW→PAPER promotion evidence with an explicit suppression marker, and
 * never contacts the broker.
 *
 * The full workflow graph (LLM agents, isolated plugin worker, DB) is not
 * unit-driveable without mock.module — which this repo forbids (process-
 * global poisoning). The shadow SEMANTICS therefore live in exported pure
 * helpers on the workflow module, tested here; the wiring itself is
 * typechecked and the zero-order property holds structurally: the shadow
 * branch returns before placeOrder is the only path to execution.
 */

const { buildShadowDecisionOutcome, isShadowSuppressedStage } = await import(
  "@/ai/workflows/consensus-workflow"
);

describe("isShadowSuppressedStage", () => {
  it("suppresses submission only for the SHADOW stage", () => {
    expect(isShadowSuppressedStage("SHADOW")).toBe(true);
  });

  it("lets capital-bearing and pre-capital stages submit", () => {
    expect(isShadowSuppressedStage("PAPER")).toBe(false);
    expect(isShadowSuppressedStage("CANARY")).toBe(false);
    expect(isShadowSuppressedStage("LIVE")).toBe(false);
    expect(isShadowSuppressedStage("BACKTEST")).toBe(false);
    expect(isShadowSuppressedStage("HALTED")).toBe(false);
  });

  it("treats missing lineage as a normal (submitting) run", () => {
    // No promotion record yet — canary controls key off lineage; shadow
    // suppression must not silently expand to lineage-less plugins.
    expect(isShadowSuppressedStage(undefined)).toBe(false);
    expect(isShadowSuppressedStage("")).toBe(false);
  });
});

describe("buildShadowDecisionOutcome", () => {
  it("preserves the real risk approval verbatim with a suppression marker", () => {
    const outcome = buildShadowDecisionOutcome({
      approved: true,
      positionSizePct: 4.5,
      reason: "Within limits: 4.5% of book on BTC-USD, daily loss cap 3%",
    });
    expect(outcome.blocked).toBe(true);
    expect(outcome.order).toBeNull();
    expect(outcome.risk.approved).toBe(true);
    expect(outcome.risk.positionSizePct).toBe(4.5);
    expect(outcome.risk.reason).toContain("SHADOW MODE — order suppressed");
    expect(outcome.risk.reason).toContain("would have executed 4.5% of book");
    // The kernel's own reason survives the prefix for the promotion record.
    expect(outcome.risk.reason).toContain("Within limits");
  });

  it("records a would-have-been-refused evaluation honestly", () => {
    const outcome = buildShadowDecisionOutcome({
      approved: false,
      positionSizePct: 0,
      reason: "Daily loss 3% reached the 3% cap — no further trades today",
    });
    expect(outcome.risk.approved).toBe(false);
    expect(outcome.risk.reason).toContain("would have been refused");
    expect(outcome.risk.reason).toContain("reached the 3% cap");
  });

  it("never claims the kernel issued the block", () => {
    // The marker must be unmissable: a shadow record that reads like a
    // risk rejection would corrupt the SHADOW→PAPER evidence.
    const outcome = buildShadowDecisionOutcome({
      approved: true,
      positionSizePct: 2,
      reason: "Within limits",
    });
    expect(outcome.risk.reason.startsWith("SHADOW MODE")).toBe(true);
  });
});
