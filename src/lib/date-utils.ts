/**
 * Shared date/time formatting helpers for the terminal UI.
 * Centralizing these keeps formatting consistent everywhere a
 * timestamp shows up (header, activity feed, logs, trade history, etc).
 */

import { loadTerminalSettings } from "./terminal-settings";

/**
 * IANA timezone for the operator's TIMEZONE setting. The settings picker
 * uses abbreviations (UTC, EST...) for terminal aesthetics; these map to
 * real tz identifiers so `Intl` renders them correctly. Server-side and
 * uninitialized clients fall back to UTC (matches the default setting).
 */
const TZ_MAP: Record<string, string> = {
  AEST: "Australia/Brisbane",
  CET: "Europe/Paris",
  CST: "America/Chicago",
  EST: "America/New_York",
  JST: "Asia/Tokyo",
  PST: "America/Los_Angeles",
  UTC: "UTC",
};

export function activeTimezone(): string {
  if (typeof window === "undefined") {
    return "UTC";
  }
  return TZ_MAP[loadTerminalSettings().timezone] ?? "UTC";
}

export function formatTerminalTime(date: Date): string {
  return date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: activeTimezone(),
  });
}

export function formatTerminalDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
    timeZone: activeTimezone(),
    weekday: "short",
    year: "numeric",
  });
}

function _formatTerminalDateTime(date: Date): string {
  return `${formatTerminalDate(date)} ${formatTerminalTime(date)}`;
}

function _formatTimeAgo(date: Date) {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}
