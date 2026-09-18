/** Locale-safe number formatters — always use "en-US" to avoid hydration mismatches */

import { loadTerminalSettings } from "./terminal-settings";

const BASE_CURRENCY_SYMBOLS: Record<string, string> = {
  BTC: "₿",
  EUR: "€",
  GBP: "£",
  JPY: "¥",
  USD: "$",
  ETH: "Ξ",
};

const BASE_CURRENCY_DECIMALS: Record<string, number> = {
  BTC: 6,
  ETH: 4,
};

/**
 * The operator's BASE CURRENCY setting (default USD). Falls back to USD
 * server-side / before hydration, matching DEFAULT_TERMINAL_SETTINGS.
 */
function baseCurrencySymbol(): string {
  if (typeof window === "undefined") return "$";
  const symbol = BASE_CURRENCY_SYMBOLS[loadTerminalSettings().baseCurrency];
  return symbol ?? "$";
}

function baseCurrencyDecimals(): number {
  if (typeof window === "undefined") return 2;
  return BASE_CURRENCY_DECIMALS[loadTerminalSettings().baseCurrency] ?? 2;
}

export function fmtPrice(n: number, decimals = 2): string {
  const d = typeof window === "undefined" ? decimals : baseCurrencyDecimals();
  return n.toLocaleString("en-US", {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  });
}

export function fmtInt(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

export function fmtPnl(n: number): string {
  const sign = n >= 0 ? "+" : "";
  return `${sign}${baseCurrencySymbol()}${fmtInt(Math.abs(n))}`;
}

export function fmtDollar(n: number): string {
  return `${baseCurrencySymbol()}${n.toLocaleString("en-US", {
    minimumFractionDigits: baseCurrencyDecimals(),
    maximumFractionDigits: baseCurrencyDecimals(),
  })}`;
}
