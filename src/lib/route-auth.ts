/**
 * Route-layer authentication guards.
 *
 * Thin compatibility layer: the terminal's API routes import
 * `requireWriteAccess` from here. The real implementation lives in
 * src/lib/session-auth.ts (session-cookie first, API-key fallback).
 *
 * @deprecated Prefer the session-aware guards in src/lib/session-auth.ts
 * when writing new routes.
 */

export { requireWriteAccess } from "@/lib/session-auth";
