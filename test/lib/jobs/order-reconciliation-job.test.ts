import { describe, expect, test } from "bun:test";

import { classifyReconciliationState } from "@/lib/jobs/order-reconciliation-policy";

describe("classifyReconciliationState", () => {
  test("finalizes a filled order only with valid quantity and price", () => {
    expect(
      classifyReconciliationState({
        avgPrice: 100,
        fillQuantity: 0.25,
        state: "filled",
      }),
    ).toBe("finalize_filled");
  });

  test("finalizes an empty cancellation as failed", () => {
    expect(
      classifyReconciliationState({
        avgPrice: 0,
        fillQuantity: 0,
        state: "canceled",
      }),
    ).toBe("finalize_failed");
  });

  test("keeps live, partial, and partial-cancel states unresolved", () => {
    for (const state of ["live", "partially_filled"] as const) {
      expect(
        classifyReconciliationState({
          avgPrice: 100,
          fillQuantity: 0.1,
          state,
        }),
      ).toBe("unresolved");
    }

    expect(
      classifyReconciliationState({
        avgPrice: 100,
        fillQuantity: 0.1,
        state: "canceled",
      }),
    ).toBe("unresolved");
  });

  test("keeps malformed filled responses unresolved", () => {
    expect(
      classifyReconciliationState({
        avgPrice: 0,
        fillQuantity: 1,
        state: "filled",
      }),
    ).toBe("unresolved");
  });
});
