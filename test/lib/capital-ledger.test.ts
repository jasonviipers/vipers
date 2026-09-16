import { describe, expect, it } from "bun:test";

import { validateBalancedEntries } from "@/lib/capital-ledger";

describe("capital ledger", () => {
  it("accepts balanced entries per currency", () => {
    expect(() =>
      validateBalancedEntries([
        { accountId: "cash", amount: 100, currency: "USDT", side: "debit" },
        {
          accountId: "equity",
          amount: 100,
          currency: "USDT",
          side: "credit",
        },
      ]),
    ).not.toThrow();
  });

  it("rejects an unbalanced transaction", () => {
    expect(() =>
      validateBalancedEntries([
        { accountId: "cash", amount: 100, currency: "USDT", side: "debit" },
        {
          accountId: "equity",
          amount: 99.99,
          currency: "USDT",
          side: "credit",
        },
      ]),
    ).toThrow("unbalanced");
  });

  it("does not net different currencies", () => {
    expect(() =>
      validateBalancedEntries([
        { accountId: "cash", amount: 100, currency: "USDT", side: "debit" },
        { accountId: "cash", amount: 100, currency: "BTC", side: "credit" },
      ]),
    ).toThrow("USDT");
  });
});
