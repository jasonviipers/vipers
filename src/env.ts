import { createEnv } from "@t3-oss/env-nextjs";
import * as z from "zod";
import { secretBoxKeySchema } from "@/lib/secret-box-key";

export const env = createEnv({
  server: {
    DATABASE_URL: z.url().min(1),
    // Optional: second Postgres database for the durable scraper store
    // (scraped messages + cache from the Reddit/news/Twitter/StockTwits
    // tools). When absent, scraper tools keep working with in-process caches
    // only and skip the write-through. Use a pooled Neon connection string.
    SCRAPER_DATABASE_URL: z.string().optional(),
    // Optional: LLM keys are managed in the /settings UI (encrypted DB
    // store). Env vars remain a bootstrap fallback for the provider
    // resolver; a missing key here just means the UI entry is required.
    GOOGLE_GENERATIVE_AI_API_KEY: z.string().optional(),
    OPENAI_API_KEY: z.string().optional(),
    ANTHROPIC_API_KEY: z.string().optional(),
    XAI_API_KEY: z.string().optional(),
    DEEPSEEK_API_KEY: z.string().optional(),
    // Optional: Ollama Cloud key (https://ollama.com/settings/keys). Powers
    // the OLLAMA provider in the fleet's per-agent model picker; when absent,
    // OLLAMA falls back to the next configured provider like any other
    // provider without a resolvable key.
    OLLAMA_API_KEY: z.string().optional(),
    // Encrypts broker/LLM credentials stored in the DB (written via the
    // /settings UI). A present-but-invalid key (not base64 of exactly 32
    // bytes) fails the boot here — the old behavior was a raw 500 on the
    // first credential save. Required in production; dev derives a
    // fallback key.
    SECRET_BOX_KEY: secretBoxKeySchema.optional(),
    // Signs short-lived session cookies (viipers_session). HMAC-SHA256.
    // Required in production; dev derives a fallback key from the DB URL.
    SESSION_SECRET: z.string().optional(),
    // Optional per-agent API keys, JSON: {"<agent-id>": "vps_...", ...}.
    // Gives each fleet member its own credential for headless HTTP access;
    // identity is still per-agent regardless (see src/lib/identity.ts).
    AGENT_API_KEYS: z.string().optional(),
    API_KEY_PATTERN: z.string().min(1),
    API_KEY_VALID: z.string().min(1),
    DEMO_API_KEY: z.string().min(1),
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    // Optional StockTwits Whisperer API key (https://stocktwitsapi.com).
    // Sent as the `x-api-key` header to api.stocktwitsapi.com/v1. When absent
    // the SENTIMENT tool degrades to a clearly labeled fallback rather than
    // inventing market data.
    STOCKTWITS_API_KEY: z.string().optional(),
    // Optional Twitter/X API v2 Bearer token for the XDK-based tweet
    // sentiment tool. X_API_BEARER_TOKEN is the canonical name; the legacy
    // TWITTER_BEARER_TOKEN is kept as an alias. When both are absent the tool
    // returns unconfigured:true instead of inventing tweets.
    X_API_BEARER_TOKEN: z.string().optional(),
    TWITTER_BEARER_TOKEN: z.string().optional(),
    // Optional Reddit app-only OAuth credentials (script-app). When both are
    // set, reddit fetches authenticate against https://oauth.reddit.com with
    // an app access token (client_credentials), bypassing the public
    // .json 403 network blocks. When absent the tool falls back to the
    // public endpoints and honestly reports blocked status instead.
    REDDIT_CLIENT_ID: z.string().optional(),
    REDDIT_CLIENT_SECRET: z.string().optional(),
    // Optional Composio Platform project key (dashboard.composio.dev →
    // Platform). Powers the /channels integration page and the Composio-
    // backed Reddit fetch (src/lib/composio.ts): the operator connects
    // Reddit/Discord/etc. once, and the fleet runs tools through that
    // connection under the stable "operator" user id. When absent, channel
    // status reports unconfigured and the Reddit tool degrades to the RSS
    // source instead of inventing posts.
    COMPOSIO_API_KEY: z.string().optional(),
    // Optional Redis connection (Upstash rediss:// or any Redis URL). When
    // absent, caches fall back to in-process memory. Parsed by src/lib/redis.ts.
    REDIS_URL: z.string().optional(),
    // Paper execution is disabled unless its starting notional is explicit.
    PAPER_BOOK_NOTIONAL_USD: z.coerce.number().positive().optional(),
  },
  client: {
    NEXT_PUBLIC_PUBLISHABLE_KEY: z.string().min(1),
    NEXT_PUBLIC_API_KEY_PREFIX: z.string().min(1),
  },
  // If you're using Next.js < 13.4.4, you'll need to specify the runtimeEnv manually
  runtimeEnv: {
    DATABASE_URL: process.env.DATABASE_URL,
    SCRAPER_DATABASE_URL: process.env.SCRAPER_DATABASE_URL,
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
    SESSION_SECRET: process.env.SESSION_SECRET,
    AGENT_API_KEYS: process.env.AGENT_API_KEYS,
    STOCKTWITS_API_KEY: process.env.STOCKTWITS_API_KEY,
    X_API_BEARER_TOKEN: process.env.X_API_BEARER_TOKEN,
    TWITTER_BEARER_TOKEN: process.env.TWITTER_BEARER_TOKEN,
    REDDIT_CLIENT_ID: process.env.REDDIT_CLIENT_ID,
    REDDIT_CLIENT_SECRET: process.env.REDDIT_CLIENT_SECRET,
    REDIS_URL: process.env.REDIS_URL,
    COMPOSIO_API_KEY: process.env.COMPOSIO_API_KEY,
    PAPER_BOOK_NOTIONAL_USD: process.env.PAPER_BOOK_NOTIONAL_USD,
    OLLAMA_API_KEY: process.env.OLLAMA_API_KEY,
  },
});
