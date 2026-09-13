"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Renders a value and flashes it green/red (existing .flash-up/.flash-down
 * CSS) whenever the numeric input changes between polls.
 *
 * The animation restarts by remounting the inner span via a monotonically
 * increasing key — the cheapest reliable way to re-trigger a CSS animation
 * without class juggling or double-rAF hacks. Reduced-motion is handled in
 * globals.css (flash keyframes are disabled there).
 */
export function FlashValue({
  value,
  format,
  className = "",
  title,
}: {
  /** Current numeric value; changes trigger the flash. */
  value: number;
  /** Render function for the displayed text. */
  format: (n: number) => string;
  /** Extra classes for the outer span. */
  className?: string;
  /** Optional title (tooltip) text. */
  title?: string;
}) {
  const [flash, setFlash] = useState<"up" | "down" | null>(null);
  const [renderCount, setRenderCount] = useState(0);
  const prevRef = useRef<number | null>(null);

  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = value;
    if (prev === null || prev === value) {
      return;
    }
    setFlash(value > prev ? "up" : "down");
    setRenderCount((c) => c + 1);
    const timer = setTimeout(() => setFlash(null), 700);
    return () => clearTimeout(timer);
  }, [value]);

  return (
    <span className={className} title={title}>
      <span
        key={renderCount}
        className={
          flash === "up"
            ? "flash-up"
            : flash === "down"
              ? "flash-down"
              : undefined
        }
      >
        {format(value)}
      </span>
    </span>
  );
}
