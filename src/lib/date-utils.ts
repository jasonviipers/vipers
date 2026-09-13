/**
 * Shared date/time formatting helpers for the terminal UI.
 * Centralizing these keeps formatting consistent everywhere a
 * timestamp shows up (header, activity feed, logs, trade history, etc).
 */

export function formatTerminalTime(date: Date): string {
  return date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

export function formatTerminalDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatTerminalDateTime(date: Date): string {
  return `${formatTerminalDate(date)} ${formatTerminalTime(date)}`;
}
