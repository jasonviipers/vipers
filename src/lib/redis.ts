import Redis from "ioredis";

import { env } from "@/env";

/**
 * Shared Redis client (ioredis).
 *
 * - Single lazy singleton per process; safe to import anywhere.
 * - Connection is only attempted when REDIS_URL is set; every accessor
 *   returns null otherwise so callers fall back to in-memory caching.
 * - Fail-safe by design: Upstash/serverless sockets drop and Redis may be
 *   down — the cache must degrade to "miss", never throw into a request
 *   path. All commands are wrapped by `safeCommand`.
 * - `rediss://` (TLS) is required by Upstash and handled natively by
 *   ioredis; maxmemory-policy on Upstash defaults to allkeys-lru, which is
 *   what a cache wants.
 */

let client: Redis | null = null;
let connectionAttempted = false;

/** Last known connection state, for logging/debugging. */
export type RedisState = "disabled" | "connecting" | "ready" | "error";
let state: RedisState = "disabled";

export function getRedisState(): RedisState {
  return state;
}

function createClient(): Redis | null {
  if (!env.REDIS_URL) {
    return null;
  }
  connectionAttempted = true;
  state = "connecting";
  const redis = new Redis(env.REDIS_URL, {
    // Upstash closes idle connections; ioredis reconnects with backoff.
    maxRetriesPerRequest: 1,
    retryStrategy: (times) => Math.min(times * 500, 10_000),
    // Queue early commands until the socket is up (bounded per-command by
    // maxRetriesPerRequest), so the first cache read after boot succeeds
    // instead of racing the TLS handshake.
    enableOfflineQueue: true,
    lazyConnect: false,
  });

  redis.on("ready", () => {
    state = "ready";
  });
  redis.on("error", (error) => {
    // Logged via console to avoid coupling lib/ to the evlog request scope;
    // the global `log` import would work too but adds a dependency cycle
    // risk for a module imported by request paths.
    state = "error";
    console.error("[redis] connection error:", error.message);
  });
  redis.on("end", () => {
    state = "error";
  });

  return redis;
}

/** Returns the shared client, or null when Redis is disabled/unavailable. */
export function getRedis(): Redis | null {
  if (!connectionAttempted) {
    client = createClient();
  }
  return client;
}

/**
 * Run a command without ever throwing. Returns null on any failure
 * (disabled, offline, wrong type, timeout) so callers treat it as a miss.
 */
export async function safeCommand<T>(
  fn: (redis: Redis) => Promise<T>,
): Promise<T | null> {
  const redis = getRedis();
  if (!redis) return null;
  try {
    return await fn(redis);
  } catch {
    return null;
  }
}

// -- Cache helpers ------------------------------------------------------------

/**
 * JSON get/set with TTL (seconds). Both sides fail-safe: a dead Redis just
 * means cache misses.
 */
export async function cacheGetJson<T>(key: string): Promise<T | null> {
  const raw = await safeCommand((redis) => redis.get(key));
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    // Corrupt entry: drop it so the next write isn't shadowed.
    await safeCommand((redis) => redis.del(key));
    return null;
  }
}

export async function cacheSetJson(
  key: string,
  value: unknown,
  ttlSeconds: number,
): Promise<void> {
  await safeCommand((redis) =>
    redis.set(key, JSON.stringify(value), "EX", ttlSeconds),
  );
}
