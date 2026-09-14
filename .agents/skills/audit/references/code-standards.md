# Viipers Architecture Reference

Condensed from the project's own README. This is a snapshot, not a live view of
the code — confirm file paths and behavior against the actual repository, since
it will have evolved since this was written.

## Stack

Next.js (App Router) · Mastra (agent framework) · Drizzle ORM over Postgres ·
TanStack Query · Tailwind · shadcn/ui · Bun as the package manager/runtime.

## The consensus pipeline

The core of the system is `src/mastra/workflows/consensus-workflow.ts` — a
five-stage pipeline that runs for every candidate trade (asset + source, e.g.
`BTC-USD`, `"manual"`):

```
asset + source
      │
      ▼
1. SENTIMENT — sentiment-agent
   gatherMarketSignals → social volume, sentiment score, highlights
   (Reddit / Twitter / RSS / StockTwits crowd data)
      │ event: SIGNAL_CREATED
      ▼
2. ANALYSIS — technical-analysis-agent + reasoning-analysis-agent
   analyzeTechnicals (trend, RSI, regime, patterns) + fetchMarketQuote
   → LLM proposal: LONG/SHORT, confidence 0–1, rationale
      │ event: ANALYSIS_PROPOSED
      ▼
3. COORDINATION — orchestrator-agent
   aggregates votes, forms consensus — ADVISORY ONLY, never approves
      │ event: CONSENSUS_REACHED
      ▼
4. RISK — risk-agent  ◄── MANDATORY GATE
   evaluateRisk → position size, exposure, drawdown
   RISK_REJECTED → proposal dropped, pipeline ends here
      │ event: RISK_APPROVED
      ▼
5. EXECUTION — order-executor-agent — the ONLY order submitter
   submitOrder → broker (OKX live / paper book)
      │
      ▼
ORDER_SUBMITTED / ORDER_FILLED / ORDER_FAILED
```

Every stage publishes to a typed event stream that feeds the dashboard's live
feed, the notification bell, and activity charts.

### The two invariants that keep this safe

1. **Consensus is advisory only.** The orchestrator recommends; it never has
   authority to approve a trade for execution.
2. **Risk is a mandatory, deterministic gate.** Nothing reaches
   `order-executor-agent` without a `RISK_APPROVED` decision, and
   `order-executor-agent` is the only component with broker access. Any change
   that lets another agent or tool reach the broker directly breaks this
   invariant — see Core Principle #4 in the main skill file.

## Caching

Market quotes are cached in two layers to protect upstream APIs
(CoinGecko/Yahoo) and survive restarts:

- **L1** — in-process `Map`.
- **L2** — Redis via `ioredis`, only when `REDIS_URL` is set (e.g. Upstash
  `rediss://`).

Redis is fail-safe by design: any Redis error degrades to a cache miss, it
never throws up into the caller. See `src/lib/redis.ts` and
`src/mastra/tools/market-quote-tool.ts`. If you touch caching, preserve the
fail-safe property — a cache outage should never become a trading outage.

## Background jobs

Scheduled from `instrumentation.ts` in production (dev triggers them manually
via `POST /api/jobs/...`):

- **portfolio-snapshot** — hourly capital rollup into `portfolio_snapshots`,
  feeding the dashboard equity curve, plus a ledger backfill.
- **leaderboard-score** — persists each agent's composite leaderboard score
  (with a trade-count activity floor) into `agent_stats.score`, via
  `src/lib/leaderboard-score.ts` (the single source of truth for the formula),
  so rankings survive restarts and are consistent across viewers.

## Folder layout

```
instrumentation.ts          Prod-only job scheduler
drizzle.config.ts           Drizzle Kit config
src/
  app/                      Next.js App Router
    page.tsx                Overview dashboard
    agents/ signals/ positions/ strategies/ consensus/ leaderboard/ settings/
                             One terminal page per domain
    api/
      agents/db/            Fleet payload: configs + runtime status + stats
      consensus/proposals/  Proposals + vote counts (DB, events fallback)
      events/recent/        Live runtime event feed (notification source)
      jobs/                 Manual job triggers
      notifications/read-state/  Per-reader notification sync (API-key identity)
      positions/            Open + closed positions
      quotes/               Ticker quotes (2-layer cached)
      signals/              Signal feed + hourly activity
      strategies/           Strategy CRUD
      status/               Portfolio summary + equity history
      trades/activity/      Hourly trade activity buckets
  components/
    dashboard/ pages/ terminal/ settings/ charts/ ui/
  context/                  React contexts (broker accounts, color scheme)
  db/
    schema/                 Drizzle tables: agents, trading, consensus, signals,
                             strategies, portfolio, notifications, auth
    migrations/             Generated SQL migrations (drizzle-kit)
  hooks/                    Client hooks
  lib/
    redis.ts                Fail-safe Redis client
    jobs/                   Background job modules
    queries/                TanStack Query factories (typed DTOs per domain)
    mutations/               Optimistic mutation hooks
    leaderboard-score.ts    Composite score + activity floor
    evlog.ts                Structured logging (wide events)
    …                       auth, api-key, formatting, terminal settings
  mastra/                   The agent swarm
    agents/                 Agent configs + bound Mastra Agent instances
    tools/                  market data, sentiment, technicals, risk,
                             execution, StockTwits
    workflows/              consensus-workflow.ts
    events/                 Typed event contracts + pub/sub bus
    runtime/                In-process agent runtime (heartbeats, metrics)
    broker/                 Broker connectivity (OKX, paper book)
  env.ts                    Validated env schema (t3-oss/env-nextjs + zod)
```

## Database

Local Postgres via Docker (`docker compose up -d`), schema pushed with
`bun run db:push`. Other commands: `db:generate` (migrations from schema),
`db:migrate` (apply migrations), `db:studio` (browse data). Schema domains to
know: `agents`, `trading`, `consensus`, `signals`, `strategies`, `portfolio`,
`notifications`, `auth`.

## Environment

`.env.example` → `.env`: database URL, Google AI key, terminal API keys.
`REDIS_URL` is optional (caching only, fail-safe if absent or erroring). Env is
validated centrally in `src/env.ts` — new required variables should go through
that schema, not a raw `process.env` read, so misconfiguration fails fast
instead of surfacing as a mysterious runtime bug.
