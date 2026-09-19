"use client";

import { createContext, useContext } from "react";

/**
 * The single source of truth for "is the terminal unlocked."
 *
 * The session probe in terminal-layout.tsx resolves to:
 *   null  — still loading / unknown (treat as locked: don't fetch, don't
 *           render error UI)
 *   true  — authenticated (operator key or demo)
 *   false — confirmed unauthenticated
 *
 * Every gated query and the full-viewport overlay read THIS value — never a
 * second cookie probe or localStorage marker — so "not yet authorized" is one
 * state everywhere and can never be mistaken for a data error.
 */
const TerminalAuthContext = createContext<boolean>(false);

export function TerminalAuthProvider({
  authenticated,
  children,
}: {
  authenticated: boolean;
  children: React.ReactNode;
}) {
  return (
    <TerminalAuthContext.Provider value={authenticated}>
      {children}
    </TerminalAuthContext.Provider>
  );
}

/**
 * True only when the terminal session probe has confirmed a valid session.
 * False while unknown (loading) and while logged out — both are "not
 * authorized yet," and must gate fetches without rendering failure UI.
 */
export function useTerminalAuthenticated(): boolean {
  return useContext(TerminalAuthContext);
}
