"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { clearClientSession, saveClientSession } from "@/lib/api-key";
import { unlockAudio } from "@/lib/sound";
import { loadTerminalSettings } from "@/lib/terminal-settings";
import { AuthModal } from "./auth-modal";
import { StatusBar } from "./status-bar";
import { TerminalBottomNav } from "./terminal-bottom-nav";
import { TerminalHeader } from "./terminal-header";
import { TickerBar } from "./ticker-bar";
import { WebMCPTools } from "./webmcp-tools";

/**
 * Ask the server whether a signed session cookie exists; the cookie itself is
 * HttpOnly so the browser cannot read it directly.
 */
async function checkSession(signal?: AbortSignal): Promise<{
  authenticated: boolean;
  demo: boolean;
}> {
  try {
    const res = await fetch("/api/auth/session", { cache: "no-store", signal });
    if (!res.ok) return { authenticated: false, demo: false };
    const payload = (await res.json()) as {
      authenticated?: unknown;
      demo?: unknown;
    };
    return {
      authenticated: payload?.authenticated === true,
      demo: payload?.demo === true,
    };
  } catch {
    return { authenticated: false, demo: false };
  }
}

export function TerminalLayout({ children }: { children: React.ReactNode }) {
  const [compact, setCompact] = useState(false);
  const [animations, setAnimations] = useState(true);
  const [tickerEnabled, setTickerEnabled] = useState(true);
  const queryClient = useQueryClient();

  const sessionQuery = useQuery({
    queryKey: ["terminal-session"],
    queryFn: async () => checkSession(),
    retry: false,
  });
  // The auth gate reads "unknown / authenticated / unauthenticated": null
  // while the session probe is still in flight, then true/false.
  const authenticated =
    sessionQuery.isLoading || sessionQuery.isPending
      ? null
      : Boolean(sessionQuery.data?.authenticated);

  useEffect(() => {
    if (sessionQuery.data?.authenticated) {
      saveClientSession({ demo: sessionQuery.data.demo });
    }
  }, [sessionQuery.data]);

  // Apply display settings on mount and live on save.
  useEffect(() => {
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
    // Reads that 401'd before login are stale; refetch once the cookie is set.
    queryClient.invalidateQueries({ queryKey: ["terminal-session"] });
    queryClient.invalidateQueries();
  }

  async function handleSignOut() {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // Server-side session expiry/cookie clearing is best-effort here; the
      // client marker below is cleared regardless.
    }
    clearClientSession();
    queryClient.setQueryData(["terminal-session"], {
      authenticated: false,
      demo: false,
    });
  }

  if (authenticated === null) {
    return (
      <div className="flex h-dvh items-center justify-center bg-background">
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
      className={`relative isolate flex h-dvh flex-col overflow-hidden bg-background ${
        compact ? "[&_span]:!text-[11px]!" : ""
      }`}
    >
      {tickerEnabled && <TickerBar />}
      {authenticated && <WebMCPTools />}
      <TerminalHeader onSignOut={handleSignOut} />
      <main
        id="main-content"
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
      >
        {children}
      </main>
      <TerminalBottomNav />
      <StatusBar />
      {!authenticated && <AuthModal onAuthenticate={handleAuthenticate} />}
    </div>
  );
}
