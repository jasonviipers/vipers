"use client";

import { useEffect, useState } from "react";
import { clearStoredApiKey, getStoredApiKey } from "@/lib/api-key";
import { unlockAudio } from "@/lib/sound";
import { loadTerminalSettings } from "@/lib/terminal-settings";
import { AuthModal } from "./auth-modal";
import { StatusBar } from "./status-bar";
import { TerminalBottomNav } from "./terminal-bottom-nav";
import { TerminalHeader } from "./terminal-header";
import { TickerBar } from "./ticker-bar";

export function TerminalLayout({ children }: { children: React.ReactNode }) {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [compact, setCompact] = useState(false);
  const [animations, setAnimations] = useState(true);
  const [tickerEnabled, setTickerEnabled] = useState(true);

  useEffect(() => {
    setAuthenticated(getStoredApiKey() !== null);
    // Apply display settings on mount and live on save.
    const apply = () => {
      const s = loadTerminalSettings();
      setCompact(s.compactMode);
      setAnimations(s.animationsEnabled);
      setTickerEnabled(s.tickerBarEnabled);
    };
    apply();
    window.addEventListener("viipers:settings-changed", apply);
    return () => window.removeEventListener("viipers:settings-changed", apply);
  }, []);

  function handleAuthenticate() {
    setAuthenticated(true);
  }

  function handleSignOut() {
    clearStoredApiKey();
    setAuthenticated(false);
  }

  if (authenticated === null) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <span className="text-xs uppercase tracking-widest text-muted-foreground animate-pulse">
          Initializing terminal...
        </span>
      </div>
    );
  }

  return (
    <div
      onPointerDown={unlockAudio}
      data-animations={animations ? "on" : "off"}
      className={`flex h-screen flex-col overflow-hidden bg-background ${
        compact ? "[&_span]:!text-[11px]" : ""
      }`}
    >
      {tickerEnabled && <TickerBar />}
      <TerminalHeader onSignOut={handleSignOut} />
      <main id="main-content" className="flex-1 overflow-auto">
        {children}
      </main>
      <TerminalBottomNav />
      <StatusBar />
      {!authenticated && <AuthModal onAuthenticate={handleAuthenticate} />}
    </div>
  );
}
