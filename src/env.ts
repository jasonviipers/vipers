import { createEnv } from "@t3-oss/env-nextjs";
import * as z from "zod";

export const env = createEnv({
  server: {
    DATABASE_URL: z.url(),
    MASTRA_DATABASE_URL: z.url(),
    // Optional: LLM keys are managed in the /settings UI (encrypted DB
    // store). Env vars remain a bootstrap fallback for the provider
    // resolver; a missing key here just means the UI entry is required.
    GOOGLE_GENERATIVE_AI_API_KEY: z.string().optional(),
    OPENAI_API_KEY: z.string().optional(),
    ANTHROPIC_API_KEY: z.string().optional(),
    XAI_API_KEY: z.string().optional(),
    DEEPSEEK_API_KEY: z.string().optional(),
    // Encrypts broker/LLM credentials stored in the DB (written via the
    // /settings UI). Required in production; dev derives a fallback key.
    SECRET_BOX_KEY: z.string().optional(),
    API_KEY_PATTERN: z.string().min(1),
    API_KEY_VALID: z.string().min(1),
    DEMO_API_KEY: z.string().min(1),
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    // Optional StockTwits application-level access token. Public stream reads
    // work without it but are often blocked by the platform's bot challenge;
    // the token makes the SENTIMENT tool reliable.
    STOCKTWITS_TOKEN: z.string().optional(),
    // Optional Redis connection (Upstash rediss:// or any Redis URL). When
    // absent, caches fall back to in-process memory. Parsed by src/lib/redis.ts.
    REDIS_URL: z.string().optional(),
  },
  client: {
    NEXT_PUBLIC_PUBLISHABLE_KEY: z.string().min(1),
    NEXT_PUBLIC_API_KEY_PREFIX: z.string().min(1),
  },
  // If you're using Next.js < 13.4.4, you'll need to specify the runtimeEnv manually
  runtimeEnv: {
    DATABASE_URL: process.env.DATABASE_URL,
    MASTRA_DATABASE_URL: process.env.MASTRA_DATABASE_URL,
    GOOGLE_GENERATIVE_AI_API_KEY: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
    NEXT_PUBLIC_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_PUBLISHABLE_KEY,
    API_KEY_PATTERN: process.env.API_KEY_PATTERN,
    API_KEY_VALID: process.env.API_KEY_VALID,
    DEMO_API_KEY: process.env.DEMO_API_KEY,
    NEXT_PUBLIC_API_KEY_PREFIX: process.env.NEXT_PUBLIC_API_KEY_PREFIX,
    NODE_ENV: process.env.NODE_ENV,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    XAI_API_KEY: process.env.XAI_API_KEY,
    DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
    SECRET_BOX_KEY: process.env.SECRET_BOX_KEY,
    STOCKTWITS_TOKEN: process.env.STOCKTWITS_TOKEN,
    REDIS_URL: process.env.REDIS_URL,
  },
});
