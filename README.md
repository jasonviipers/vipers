# Viipers — Multi-Agent Trading Terminal

Viipers is an AI trading terminal: a swarm of specialized LLM agents (sentiment, analysis, risk, execution, coordination) analyze market signals, vote on trade proposals, gate them through a mandatory risk check, and execute orders — while a real-time terminal-style dashboard shows every stage of the pipeline. Built with Next.js (App Router), Mastra, Drizzle ORM/Postgres, TanStack Query, and Tailwind.

## How It Works

The heart of the system is the **consensus workflow** (`src/mastra/workflows/consensus-workflow.ts`) — a five-step pipeline that runs for every candidate trade:

### Pipeline Architecture

```
                     asset + source (e.g. BTC-USD, "manual")
                                  │
                                  ▼
┌────────────────────────────────────────────────────────────────────┐
│ 1 · SENTIMENT · sentiment-agent                                    │
│     gatherMarketSignals → social volume, sentiment score,          │
│     highlights (Reddit · Twitter · RSS · StockTwits crowd)         │
└────────────────────────────────────────────────────────────────────┘
                                  │ SIGNAL_CREATED
                                  ▼
┌────────────────────────────────────────────────────────────────────┐
│ 2 · ANALYSIS · technical-analysis-agent                            │
│              + reasoning-analysis-agent                            │
│     analyzeTechnicals (trend · RSI · regime · patterns)            │
│     + fetchMarketQuote → LLM proposal: LONG/SHORT,                 │
│       confidence 0–1, rationale                                    │
└────────────────────────────────────────────────────────────────────┘
                                  │ ANALYSIS_PROPOSED
                                  ▼
┌────────────────────────────────────────────────────────────────────┐
│ 3 · COORDINATION · orchestrator-agent                              │
│     aggregates votes, forms consensus — advisory only              │
└────────────────────────────────────────────────────────────────────┘
                                  │ CONSENSUS_REACHED
                                  ▼
┌────────────────────────────────────────────────────────────────────┐
│ 4 · RISK · risk-agent ─── MANDATORY GATE                           │
│     evaluateRisk → position size · exposure · drawdown             │
│         RISK_REJECTED ──► proposal dropped (pipeline ends)         │
└────────────────────────────────────────────────────────────────────┘
                                  │ RISK_APPROVED
                                  ▼
┌────────────────────────────────────────────────────────────────────┐
│ 5 · EXECUTION · order-executor-agent ── only order submitter       │
│     submitOrder → broker (OKX live / paper book)                   │
└────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼

          ORDER_SUBMITTED / ORDER_FILLED / ORDER_FAILED

     Every stage publishes to the typed event stream along the way —
     it feeds the dashboard live feed, the notification bell, and the
     activity charts.
```

1. **SENTIMENT** (`sentiment-agent`) gathers the market signal for an asset — social volume, sentiment score, and highlights from Reddit/Twitter/RSS, plus StockTwits crowd data.
2. **ANALYSIS** (`technical-analysis-agent`, `reasoning-analysis-agent`) pulls the technical snapshot (trend, RSI, regime, patterns) and an LLM reasons over signal + technicals to produce a trade proposal: direction (LONG/SHORT), confidence 0–1, rationale.
3. **COORDINATION** (`orchestrator-agent`) aggregates votes and forms consensus. Consensus is **advisory only** — it recommends, it never approves.
4. **RISK** (`risk-agent`) is the **mandatory gate**: position sizing, exposure limits, drawdown checks. Nothing reaches execution without a `RISK_APPROVED` decision.
5. **EXECUTION** (`order-executor-agent`) is the **only** component allowed to submit broker orders, and only for risk-approved proposals.

Two invariants keep the swarm safe: consensus approval is advisory, and every state transition is published to a typed event stream (`SIGNAL_CREATED`, `ANALYSIS_PROPOSED`, `CONSENSUS_REACHED`, `RISK_*`, `ORDER_*`) that powers the dashboard's live feed and notification bell.

### Caching

Market quotes are cached in two layers to protect the upstream APIs (CoinGecko/Yahoo) and survive restarts: an in-process Map (L1) and Redis via ioredis (L2, when `REDIS_URL` is set — e.g. Upstash `rediss://`). Redis is fail-safe by design: any error degrades to a cache miss, never a thrown error. See `src/lib/redis.ts` and `src/mastra/tools/market-quote-tool.ts`.

### Background Jobs

Production schedules hourly rollups from `instrumentation.ts` (dev triggers them manually via `POST /api/jobs/...`):

- **portfolio-snapshot** — hourly capital rollup into `portfolio_snapshots`, feeding the dashboard equity curve (plus a ledger backfill).
- **leaderboard-score** — persists each agent's composite leaderboard score (with a trade-count activity floor) into `agent_stats.score`, so rankings survive restarts and every viewer sees the same standings.

## Folder Structure

```
├── instrumentation.ts          # Prod-only job scheduler (portfolio + leaderboard rollups)
├── drizzle.config.ts           # Drizzle Kit config (schema, migrations, Postgres)
├── src/
│   ├── app/                    # Next.js App Router
│   │   ├── page.tsx            # Overview dashboard (equity, consensus, live feed)
│   │   ├── agents/ signals/ positions/ strategies/ consensus/ leaderboard/ settings/
│   │   │                       # One terminal page per domain (TerminalLayout + view)
│   │   └── api/
│   │       ├── agents/db/      # Fleet payload: configs + runtime status + stats
│   │       ├── consensus/proposals/  # Proposals + vote counts (DB w/ events fallback)
│   │       ├── events/recent/  # Live runtime event feed (notification source)
│   │       ├── jobs/           # Manual job triggers (portfolio-snapshot, leaderboard-score)
│   │       ├── notifications/read-state/  # Per-reader notification sync (API-key identity)
│   │       ├── positions/      # Open + closed positions
│   │       ├── quotes/         # Ticker quotes (2-layer cached)
│   │       ├── signals/        # Signal feed + hourly activity
│   │       ├── strategies/     # Strategy CRUD
│   │       ├── status/         # Portfolio summary + equity history
│   │       └── trades/activity/      # Hourly trade activity buckets
│   ├── components/
│   │   ├── dashboard/          # Dashboard cards (equity chart, positions, consensus panel…)
│   │   ├── pages/              # Full-page views (one per route)
│   │   ├── terminal/           # Terminal chrome: header, ticker bar, nav, notification bell
│   │   ├── settings/           # Broker accounts, settings widgets
│   │   ├── charts/             # Chart primitives (lightweight-charts, sparklines)
│   │   └── ui/                 # shadcn/ui primitives
│   ├── context/                # React contexts (broker accounts, color scheme)
│   ├── db/
│   │   ├── schema/             # Drizzle tables: agents, trading, consensus, signals,
│   │   │                       # strategies, portfolio, notifications, auth
│   │   └── migrations/         # Generated SQL migrations (drizzle-kit)
│   ├── hooks/                  # Client hooks (use-notifications, use-hide-on-scroll)
│   ├── lib/
│   │   ├── redis.ts            # Fail-safe Redis client (cache helpers, singleton)
│   │   ├── jobs/               # Background job modules (snapshot, leaderboard score)
│   │   ├── queries/            # TanStack Query factories (typed DTOs per domain)
│   │   ├── mutations/          # Optimistic mutation hooks (strategies, notifications)
│   │   ├── leaderboard-score.ts # Composite score + activity floor (single source of truth)
│   │   ├── evlog.ts            # Structured logging (wide events)
│   │   └── …                   # auth, api-key, formatting, terminal settings
│   ├── mastra/                 # The agent swarm
│   │   ├── agents/             # Agent configs + bound Mastra Agent instances
│   │   ├── tools/              # Capabilities: market data, sentiment, technicals,
│   │   │                       # risk, execution, StockTwits
│   │   ├── workflows/          # consensus-workflow (signal → … → execution pipeline)
│   │   ├── events/             # Typed event contracts + pub/sub bus
│   │   ├── runtime/            # In-process agent runtime (heartbeats, metrics, events)
│   │   └── broker/             # Broker connectivity (OKX, paper book)
│   └── env.ts                  # Validated env schema (t3-oss/env-nextjs + zod)
```

## Database (local Postgres via Docker)

Start Postgres:

```bash
docker compose up -d
```

Then push the schema:

```bash
bun run db:push
```

Other database commands: `db:generate` (create migrations from schema), `db:migrate` (apply migrations), `db:studio` (browse data).

## Getting Started

1. Copy `.env.example` to `.env` and fill in the required keys (database URL, Google AI key, terminal API keys; `REDIS_URL` optional).
2. Start Postgres and push the schema (above).
3. Run the dev server:

```bash
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Learn More

- [Next.js Documentation](https://nextjs.org/docs) — learn about Next.js features and API.
- [Mastra Documentation](https://mastra.ai/docs) — the agent framework powering the swarm.
- [Drizzle ORM](https://orm.drizzle.team/docs/overview) — schema-first SQL ORM.
- [TanStack Query](https://tanstack.com/query/latest) — data fetching and optimistic updates.
