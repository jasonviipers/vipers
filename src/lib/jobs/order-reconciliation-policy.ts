export type ReconciliationDecision =
  | "finalize_failed"
  | "finalize_filled"
  | "unresolved";

/** Pure state classifier; it never treats an uncertain exchange state as terminal. */
export function classifyReconciliationState(input: {
  avgPrice: number;
  fillQuantity: number;
  state: "canceled" | "filled" | "live" | "partially_filled";
}): ReconciliationDecision {
  if (
    input.state === "filled" &&
    input.fillQuantity > 0 &&
    input.avgPrice > 0
  ) {
    return "finalize_filled";
  }
  if (input.state === "canceled" && input.fillQuantity === 0) {
    return "finalize_failed";
  }
  return "unresolved";
}
