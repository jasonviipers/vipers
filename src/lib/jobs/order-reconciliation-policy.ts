export type ReconciliationDecision =
  | "finalize_failed"
  | "finalize_filled"
  | "unresolved";

/** Pure state classifier; it never treats an uncertain exchange state as terminal. */
export function classifyReconciliationState(input: {
  avgPrice: number;
  fillQuantity: number;
  state:
    | "canceled"
    | "expired"
    | "filled"
    | "live"
    | "partially_filled"
    | "rejected";
}): ReconciliationDecision {
  if (
    input.state === "filled" &&
    input.fillQuantity > 0 &&
    input.avgPrice > 0
  ) {
    return "finalize_filled";
  }
  // Alpaca exposes additional zero-fill terminal states (expired day
  // orders, rejected orders) that are as dead as a cancellation.
  if (
    (input.state === "canceled" ||
      input.state === "expired" ||
      input.state === "rejected") &&
    input.fillQuantity === 0
  ) {
    return "finalize_failed";
  }
  return "unresolved";
}
