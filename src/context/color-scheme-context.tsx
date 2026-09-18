"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  COLOR_SCHEMES,
  type ColorSchemeDefinition,
  type ColorSchemeId,
} from "@/context/color-scheme-context-utils";

const STORAGE_KEY = "quantex_color_scheme";

type ColorSchemeContextValue = {
  scheme: ColorSchemeId;
  setScheme: (id: ColorSchemeId) => void;
  definition: ColorSchemeDefinition;
};

const ColorSchemeContext = createContext<ColorSchemeContextValue | null>(null);

function readStoredScheme(): ColorSchemeId | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && COLOR_SCHEMES.some((s) => s.id === stored)) {
      return stored as ColorSchemeId;
    }
  } catch {
    // localStorage can throw in private browsing / storage-restricted contexts
  }
  return null;
}

export function ColorSchemeProvider({ children }: { children: ReactNode }) {
  const [scheme, setSchemeState] = useState<ColorSchemeId>("phosphor");

  // Hydrate from localStorage on mount
  useEffect(() => {
    const stored = readStoredScheme();
    if (stored) {
      setSchemeState(stored);
    }
  }, []);

  // Single source of truth for syncing the DOM attribute
  useEffect(() => {
    document.documentElement.setAttribute("data-color-scheme", scheme);
  }, [scheme]);

  const setScheme = useCallback((id: ColorSchemeId) => {
    setSchemeState(id);
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {
      // ignore write failures (quota exceeded, storage disabled, etc.)
    }
  }, []);

  const definition =
    COLOR_SCHEMES.find((s) => s.id === scheme) ?? COLOR_SCHEMES[0];

  const providerValue = useMemo<ColorSchemeContextValue>(
    () => ({ scheme, setScheme, definition }),
    [definition, scheme, setScheme],
  );

  return (
    <ColorSchemeContext.Provider value={providerValue}>
      {children}
    </ColorSchemeContext.Provider>
  );
}

export function useColorScheme() {
  const ctx = useContext(ColorSchemeContext);
  if (!ctx)
    throw new Error("useColorScheme must be used within ColorSchemeProvider");
  return ctx;
}
