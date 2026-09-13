import { timingSafeEqual } from "node:crypto";

import { env } from "@/env";

export type ApiKeyClassification = "valid" | "demo" | "invalid";

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) {
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

export function isWellFormedApiKey(key: string): boolean {
  return new RegExp(env.API_KEY_PATTERN).test(key);
}

export function classifyApiKey(key: string): ApiKeyClassification {
  if (typeof key !== "string" || key.length === 0 || !isWellFormedApiKey(key)) {
    return "invalid";
  }
  if (safeEqual(key, env.API_KEY_VALID)) {
    return "valid";
  }
  if (safeEqual(key, env.DEMO_API_KEY)) {
    return "demo";
  }
  return "invalid";
}
