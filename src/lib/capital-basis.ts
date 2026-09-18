import type { BrokerId } from "@/channels/broker/registry";

/**
 * The unified capital basis.
 *
 * Two brokers are wired in — OKX (USDT-denominated) and Alpaca
 * (USD-denominated) — and both reconcile their account equity into the
 * same capital ledger through src/lib/broker-balance.ts. Every capital
 * reader (portfolio rollup, risk-gate denominator, rollback monitor)
 * must therefore treat the ledger's capital-currency cash accounts as ONE
 * book: a ledger holding OKX capital AND Alpaca capital reports their
 * combined total, so switching the active broker re-anchors the same book
 * to the new broker's equity instead of orphaning the old balance.
 *
 * This module is intentionally db-free (pure core, unit-testable); the
 * db-reading wrapper lives in src/lib/broker-balance.ts.
 */

/** Ledger cash currencies that count toward total capital. */
export const CAPITAL_LEDGER_CURRENCIES = ["USD", "USDT"] as const;

export type CapitalLedgerCurrency = (typeof CAPITAL_LEDGER_CURRENCIES)[number];

/**
 * Sum the capital-currency cash balances into one total. A present balance
 * always contributes — the union only reports `null` (no ledger capital)
 * when EVERY capital-currency account is unread — so a reader never
 * silently falls back to the legacy projection while real ledger capital
 * exists in the other currency.
 */
export function unifyLedgerCashBalances(
  balances: Array<number | null>,
): number | null {
  const present = balances.filter((value): value is number => value !== null);
  if (present.length === 0) {
    return null;
  }
  return present.reduce((sum, value) => sum + value, 0);
}

/**
 * Whether a runtime-settings patch switches the active broker — the
 * trigger for the capital-ledger resync in updateRuntimeSettings. A
 * same-id (or absent) patch is not a switch and must not re-reconcile.
 */
export function isActiveBrokerSwitch(
  currentActiveBrokerId: BrokerId,
  patchActiveBrokerId: BrokerId | undefined,
): patchActiveBrokerId is BrokerId {
  return (
    patchActiveBrokerId !== undefined &&
    patchActiveBrokerId !== currentActiveBrokerId
  );
}
