import { env } from "@/env";

export const API_KEY_PREFIX = env.NEXT_PUBLIC_API_KEY_PREFIX;

export const DEMO_API_KEY = "vps_demo_readonly_9f2k1m0q7x4w";

const STORAGE_KEY = "viipers_api_key";

export function getStoredApiKey(): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  return sessionStorage.getItem(STORAGE_KEY);
}

export function storeApiKey(key: string): void {
  sessionStorage.setItem(STORAGE_KEY, key);
}

export function clearStoredApiKey(): void {
  sessionStorage.removeItem(STORAGE_KEY);
}

/**
 * True when the current session authenticated with the shared demo key.
 * Demo sessions are READ-ONLY server-side (requireWriteAccess → 403); the
 * UI uses this to disable credential-management controls up front instead
 * of letting writes fail with an opaque error.
 */
export function isDemoSession(): boolean {
  return getStoredApiKey() === DEMO_API_KEY;
}
