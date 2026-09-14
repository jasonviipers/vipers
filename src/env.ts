import { createEnv } from "@t3-oss/env-nextjs";
import * as z from "zod";

export const env = createEnv({
  server: {
    DATABASE_URL: z.url(),
    MASTRA_DATABASE_URL: z.url(),
    GOOGLE_GENERATIVE_AI_API_KEY: z.string().min(1),
    API_KEY_PATTERN: z.string().min(1),
    API_KEY_VALID: z.string().min(1),
    DEMO_API_KEY: z.string().min(1),
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    // Live OKX broker credentials (optional). When absent, order execution
    // uses the paper-book stub so dev/tests never touch a real account.
    OKX_API_KEY: z.string().optional(),
    OKX_SECRET: z.string().optional(),
    OKX_PASSPHRASE: z.string().optional(),
    OKX_DEMO: z.string().optional(),
    OKX_REGION: z.enum(["default", "eea", "us"]).optional(),
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
    OKX_API_KEY: process.env.OKX_API_KEY,
    OKX_SECRET: process.env.OKX_SECRET,
    OKX_PASSPHRASE: process.env.OKX_PASSPHRASE,
    OKX_DEMO: process.env.OKX_DEMO,
    OKX_REGION: process.env.OKX_REGION,
    STOCKTWITS_TOKEN: process.env.STOCKTWITS_TOKEN,
    REDIS_URL: process.env.REDIS_URL,
  },
});
