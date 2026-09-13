"use client";

import { useEffect, useState } from "react";
import { formatTerminalDate, formatTerminalTime } from "@/lib/date-utils";

interface UseTerminalClockOptions {
  /** How often to refresh, in ms. Defaults to 1000 (1s). */
  intervalMs?: number;
}

/**
 * Live-updating terminal-style time/date strings.
 * Wherever the header's clock (useState + setInterval) logic was
 * being copy-pasted, swap it for:
 *
 *   const { time, date } = useTerminalClock()
 */
export function useTerminalClock({
  intervalMs = 1000,
}: UseTerminalClockOptions = {}) {
  const [time, setTime] = useState("");
  const [date, setDate] = useState("");

  useEffect(() => {
    const tick = () => {
      const now = new Date();
      setTime(formatTerminalTime(now));
      setDate(formatTerminalDate(now));
    };
    tick();
    const interval = setInterval(tick, intervalMs);
    return () => clearInterval(interval);
  }, [intervalMs]);

  return { time, date };
}
