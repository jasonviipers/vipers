import { beforeEach, describe, expect, it } from "bun:test";

/**
 * Paper-mode venue verification (checklist §7): the parity evaluator is
 * pure and tested directly — every check must fail closed (a missing
 * observation is a failure, not a pass by absence). The network probe is
 * thin and typechecked; the DI convention (no mock.module) keeps the
 * client's real module graph out of unit scope.
 */

const { evaluatePaperVenueProbe } = await import(
  "@/ai/capital-engine/paper-venue-verify"
);

function baseObservations(): {
  accountEquity: number | null;
  credentialsStored: boolean;
  orderLookupOk: boolean | null;
  positionsReadable: boolean | null;
  resolvedMode: "live" | "paper" | null;
} {
  return {
    accountEquity: 100_000,
    credentialsStored: true,
    orderLookupOk: true,
    positionsReadable: true,
    resolvedMode: "paper" as "live" | "paper" | null,
  };
}

describe("evaluatePaperVenueProbe", () => {
  let observations: ReturnType<typeof baseObservations>;

  beforeEach(() => {
    observations = baseObservations();
  });

  it("passes when the paper venue answers on every surface", () => {
    const result = evaluatePaperVenueProbe(observations);
    expect(result.passed).toBe(true);
    expect(result.venue).toBe("alpaca-paper");
    expect(result.checks.map((c) => c.check)).toEqual([
      "paper-route-active",
      "account-readable",
      "order-lifecycle-readable",
      "reconciliation-surface-parity",
    ]);
    expect(result.checks.every((c) => c.ok)).toBe(true);
  });

  it("fails when the active slot resolves to LIVE — the live family must never pass as paper", () => {
    observations.resolvedMode = "live";
    const result = evaluatePaperVenueProbe(observations);
    expect(result.passed).toBe(false);
    expect(result.venue).toBeNull();
    const route = result.checks.find((c) => c.check === "paper-route-active");
    expect(route?.ok).toBe(false);
    // Account/order/positions may be healthy — the route check is what
    // proves this is the paper venue, not real capital.
    expect(result.checks.find((c) => c.check === "account-readable")?.ok).toBe(
      true,
    );
  });

  it("fails closed when no credentials are stored", () => {
    observations.resolvedMode = null;
    observations.accountEquity = null;
    observations.orderLookupOk = null;
    observations.positionsReadable = null;
    const result = evaluatePaperVenueProbe(observations);
    expect(result.passed).toBe(false);
    expect(result.venue).toBeNull();
    expect(result.checks.every((c) => c.ok)).toBe(false);
  });

  it("fails closed on an unreadable or negative equity", () => {
    observations.accountEquity = null;
    expect(
      evaluatePaperVenueProbe(observations).checks.find(
        (c) => c.check === "account-readable",
      )?.ok,
    ).toBe(false);

    observations.accountEquity = -1;
    expect(
      evaluatePaperVenueProbe(observations).checks.find(
        (c) => c.check === "account-readable",
      )?.ok,
    ).toBe(false);
  });

  it("fails when the order query does not round-trip (unreconcilable paper)", () => {
    observations.orderLookupOk = false;
    const result = evaluatePaperVenueProbe(observations);
    const check = result.checks.find(
      (c) => c.check === "order-lifecycle-readable",
    );
    expect(check?.ok).toBe(false);
    expect(result.passed).toBe(false);
  });

  it("fails when the reconciliation surface (positions) is unreadable", () => {
    observations.positionsReadable = false;
    expect(evaluatePaperVenueProbe(observations).passed).toBe(false);
  });
});
