"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";

export type ColorSchemeId =
  | "phosphor"
  | "arctic"
  | "amber"
  | "crimson"
  | "matrix"
  | "synthwave";

export type ColorSchemeDefinition = {
  id: ColorSchemeId;
  label: string;
  description: string;
  colors: {
    green: string;
    amber: string;
    cyan: string;
    red: string;
    gold: string;
  };
};

export const COLOR_SCHEMES: ColorSchemeDefinition[] = [
  {
    id: "phosphor",
    label: "PHOSPHOR",
    description: "Default teal-green terminal",
    colors: {
      green: "#00d4aa",
      amber: "#ff8c00",
      cyan: "#00b8d4",
      red: "#ff4444",
      gold: "#ffd700",
    },
  },
  {
    id: "arctic",
    label: "ARCTIC",
    description: "Cool blue ice tones",
    colors: {
      green: "#4fc3f7",
      amber: "#81d4fa",
      cyan: "#b3e5fc",
      red: "#ef5350",
      gold: "#80deea",
    },
  },
  {
    id: "amber",
    label: "AMBER",
    description: "Warm amber & gold CRT",
    colors: {
      green: "#ffb300",
      amber: "#ff8f00",
      cyan: "#ffd54f",
      red: "#ff5722",
      gold: "#ffe082",
    },
  },
  {
    id: "crimson",
    label: "CRIMSON",
    description: "Red-hot trading floor",
    colors: {
      green: "#ff5252",
      amber: "#ff8a65",
      cyan: "#ff80ab",
      red: "#d32f2f",
      gold: "#ffab91",
    },
  },
  {
    id: "matrix",
    label: "MATRIX",
    description: "Classic green on black",
    colors: {
      green: "#00ff41",
      amber: "#39ff14",
      cyan: "#76ff03",
      red: "#ff1744",
      gold: "#c6ff00",
    },
  },
  {
    id: "synthwave",
    label: "SYNTHWAVE",
    description: "Neon purple retrowave",
    colors: {
      green: "#e040fb",
      amber: "#7c4dff",
      cyan: "#ea80fc",
      red: "#ff1744",
      gold: "#b388ff",
    },
  },
];

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

  return (
    <ColorSchemeContext.Provider value={{ scheme, setScheme, definition }}>
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
