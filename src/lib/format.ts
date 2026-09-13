/** Locale-safe number formatters — always use "en-US" to avoid hydration mismatches */

export function fmtPrice(n: number, decimals = 2): string {
  return n.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function fmtInt(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

export function fmtPnl(n: number): string {
  const sign = n >= 0 ? "+" : "";
  return `${sign}$${fmtInt(Math.abs(n))}`;
}

export function fmtDollar(n: number): string {
  return `$${n.toLocaleString("en-US")}`;
}
