"use client";

import { useEffect, useState } from "react";
import { useColorScheme } from "@/context/color-scheme-context";

/**
 * Reads computed CSS custom-property values from :root and re-reads
 * whenever the active color scheme changes.
 *
 * @param vars - CSS variable names WITHOUT the leading `--`, e.g. ["border", "card"]
 * @returns A record mapping each variable name to its current computed hex value.
 */
export function useCSSVars<T extends string>(vars: T[]): Record<T, string> {
  const { scheme } = useColorScheme();

  const read = (): Record<T, string> => {
    if (typeof window === "undefined") {
      return Object.fromEntries(vars.map((v) => [v, ""])) as Record<T, string>;
    }
    const style = getComputedStyle(document.documentElement);
    return Object.fromEntries(
      vars.map((v) => [v, style.getPropertyValue(`--${v}`).trim()]),
    ) as Record<T, string>;
  };

  const [values, setValues] = useState<Record<T, string>>(read);

  useEffect(() => {
    const id = requestAnimationFrame(() => setValues(read()));
    return () => cancelAnimationFrame(id);
  }, [scheme]);

  return values;
}
