import { describe, expect, it } from "bun:test";

import {
  CAPITAL_LEDGER_CURRENCIES,
  type CapitalLedgerCurrency,
  isActiveBrokerSwitch,
  unifyLedgerCashBalances,
} from "@/lib/capital-basis";

describe("unifyLedgerCashBalances", () => {
  it("returns null when every capital-currency balance is unread", () => {
    expect(unifyLedgerCashBalances([null, null])).toBeNull();
  });

  it("returns null for an empty balance list", () => {
    expect(unifyLedgerCashBalances([])).toBeNull();
  });

  it("sums balances across both capital currencies", () => {
    expect(unifyLedgerCashBalances([12_500, 340.5])).toBe(12_840.5);
  });

  it("ignores unread currencies and sums the present ones", () => {
    // Alpaca ledger has entries, OKX account not yet created.
    expect(unifyLedgerCashBalances([null, 900])).toBe(900);
    expect(unifyLedgerCashBalances([700, null])).toBe(700);
  });

  it("keeps negative balances in the union (real debt, not absence)", () => {
    expect(unifyLedgerCashBalances([100, -30])).toBe(70);
  });

  it("treats a zero balance as present capital, not absence", () => {
    expect(unifyLedgerCashBalances([0, null])).toBe(0);
  });

  it("covers exactly the ledger's capital currencies", () => {
    expect([...CAPITAL_LEDGER_CURRENCIES].sort()).toEqual(["USD", "USDT"]);
    const codes: CapitalLedgerCurrency[] = ["USD", "USDT"];
    expect(codes.length).toBe(CAPITAL_LEDGER_CURRENCIES.length);
  });
});

describe("isActiveBrokerSwitch", () => {
  it("is true when the patch selects a different broker", () => {
    expect(isActiveBrokerSwitch("okx", "alpaca")).toBe(true);
    expect(isActiveBrokerSwitch("alpaca", "okx")).toBe(true);
  });

  it("is false when the patch re-selects the current broker", () => {
    expect(isActiveBrokerSwitch("okx", "okx")).toBe(false);
    expect(isActiveBrokerSwitch("alpaca", "alpaca")).toBe(false);
  });

  it("is false when the patch omits the broker", () => {
    expect(isActiveBrokerSwitch("okx", undefined)).toBe(false);
  });

  it("narrows the patch id to BrokerId when true", () => {
    const patch: { activeBrokerId?: "okx" | "alpaca" } = {
      activeBrokerId: "alpaca",
    };
    if (isActiveBrokerSwitch("okx", patch.activeBrokerId)) {
      // The type guard guarantees a defined BrokerId inside the branch.
      const id: "okx" | "alpaca" = patch.activeBrokerId;
      expect(id).toBe("alpaca");
    } else {
      throw new Error("expected a switch");
    }
  });
});
