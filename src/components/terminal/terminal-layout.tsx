"use client";

import { useEffect, useState } from "react";
import { clearStoredApiKey, getStoredApiKey } from "@/lib/api-key";
import { AuthModal } from "./auth-modal";
import { StatusBar } from "./status-bar";
import { TerminalBottomNav } from "./terminal-bottom-nav";
import { TerminalHeader } from "./terminal-header";
import { TickerBar } from "./ticker-bar";

export function TerminalLayout({ children }: { children: React.ReactNode }) {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);

  useEffect(() => {
    setAuthenticated(getStoredApiKey() !== null);
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
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      <TickerBar />
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
