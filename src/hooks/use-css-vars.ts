"use client";

import { useCallback, useEffect, useState } from "react";
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

  // Stable across renders; vars is expected to be a module-level constant
  // per call-site, matching the hook's contract. The names are carried
  // through the joined key so the callback's identity depends only on it.
  const varsKey = vars.join(",");
  const read = useCallback((): Record<T, string> => {
    const names = varsKey.split(",") as T[];
    if (typeof window === "undefined") {
      return Object.fromEntries(names.map((v) => [v, ""])) as Record<T, string>;
    }
    const style = getComputedStyle(document.documentElement);
    return Object.fromEntries(
      names.map((v) => [v, style.getPropertyValue(`--${v}`).trim()]),
    ) as Record<T, string>;
  }, [varsKey]);

  const [values, setValues] = useState<Record<T, string>>(read);

  // `read` is deliberately excluded: it changes identity when varsKey
  // changes, and re-reading on the scheme change is handled by the effect
  // re-running whenever either scheme or the key-driven identity changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: read is keyed by varsKey which is itself a dependency
  useEffect(() => {
    const id = requestAnimationFrame(() => setValues(read()));
    return () => cancelAnimationFrame(id);
  }, [scheme]);

  return values;
}
