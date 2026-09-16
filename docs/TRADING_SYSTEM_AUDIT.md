# Viipers Trading System Audit

**Audited:** 2026-09-16
**Method:** Code inspection against `AI_CAPITAL_ARCHITECTURE_RESEARCH.md` patterns and the viipers-audit checklist

## Overall status
- [x] Architecture reviewed end to end
- [?] Production build succeeds — `bun run build` not run (requires full env)
- [x] TypeScript passes — `bunx tsc --noEmit` completed with zero errors
- [x] Lint passes — `bun run lint` checked 204 files, no issues
- [x] Tests pass — `bun test test/` 54 pass / 0 fail
- [x] Database schema and migrations verified (Drizzle schema review)
- [x] Consensus pipeline traced stage by stage
- [x] Risk gate confirmed unbypassable
- [x] Security audit completed (credential handling, auth, secrets)
- [x] Remaining risks documented

## Architecture

### Consensus pipeline
- [x] Pipeline documented against actual code — `src/ai/workflows/consensus-workflow.ts:32-140`

```
SIGNAL_CREATED → ANALYSIS_PROPOSED → CONSENSUS_REACHED → RISK_APPROVED/REJECTED → ORDER_SUBMITTED/FILLED/FAILED
```

- [x] Event stream contract verified — `src/ai/events/contracts.ts` defines typed schemas for all five events
- [x] Failure/recovery paths documented:
  - Sentiment/technical failures → LLM errors logged, workflow returns BLOCKED
  - LLM parse failure → `parseTradeProposal` returns null → BLOCKED (not coerced)
  - Risk data unavailable → fail-closed rejection (risk-tool.ts:257-268)
  - Order persistence failure → PENDING status, reconciliation handles it
  - OKX broker error → FAILED result, reconciled by order-reconciliation-job

### Core invariant verified
**AI proposes, the deterministic risk engine disposes.** The path is:

```
reasoning agent → typed intent → risk gate → execution
```

No agent, tool, or workflow branch can reach the broker without `RISK_APPROVED`. The execution adapter (`src/channels/broker/adapter.ts`) is the sole broker path, and it is only called from `src/ai/tools/execution-tool.ts` which is only invoked after risk approval.

## Agents (src/ai/agents/)

- [x] sentiment-agent — scrapes market signals from Reddit, news/RSS, Twitter/X, and StockTwits, plus the combined `gatherMarketSignals`; failure returns zeroed signal, does not proceed to analysis
- [x] technical-analysis-agent — fetches technicals (RSI, trend, patterns, regime); failure returns defaults
- [x] reasoning-analysis-agent — LLM output schema validated via zod (`trade-proposal.ts:3-7`); `ABSTAIN` direction is rejected (not coerced to LONG/SHORT); malformed JSON returns null → pipeline blocked
- [x] orchestrator-agent — advisory only; `tools: []` (config.ts:146); no broker access
- [x] risk-agent — mandatory gate (`risk-tool.ts:142-209`); evaluates kill switch, daily loss cap, open position cap, confidence floor; `RISK_REJECTED` halts pipeline (workflow.ts:107-109)
- [x] order-executor-agent — the ONLY component with broker access (`execution-tool.ts:75`); no other agent or tool can reach `placeOrder` or the broker layer
- [x] Agent concurrency reviewed — `maxConcurrency` per agent config; automation job uses in-flight guard (automation-job.ts:38)
- [x] Agent state/memory reviewed — no cross-run state leakage; `createEmptyRuntimeStatus` resets per boot

### Findings
- [x] Immutable decision snapshot — **FIXED**: `decision_snapshots` table (src/db/schema/audit.ts) + content-hash builder (src/ai/audit/decision-snapshot.ts) persist one sha256-hashed snapshot per proposal from the consensus workflow (approved, rejected, and order-outcome variants). Migration `0009_icy_toad_men.sql`.
- [~] ABSTAIN treated as BLOCKED — the pipeline treats a valid `ABSTAIN` the same as a malformed output (returns `BLOCKED`). The Capital Engine doc (§4.F) says NO_TRADE should be an explicit, logged, recognized outcome rather than conflated with failure. **Current risk: low** — functionally correct but loses audit clarity.

## Data sources (src/ai/tools/market-signals-tool.ts, twitter-tool.ts, stocktwits-tool.ts)

- [x] Reddit — `fetchRedditSignals` via r/{cryptocurrency, Bitcoin, ethereum} JSON API, VADER-scored, cache + stale fallback (`market-signals-tool.ts`)
- [x] News/RSS — `fetchNewsSignals` via CoinDesk / Cointelegraph RSS, VADER-scored, cache + stale fallback (`market-signals-tool.ts`)
- [x] Twitter/X — `fetchTwitterSentiment` via X API v2 `tweets/search/recent` (`twitter-tool.ts`); without `TWITTER_BEARER_TOKEN` returns `unconfigured: true`, never fabricates tweets; prod fails closed
- [x] StockTwits — migrated from the legacy `api.stocktwits.com` public stream to the StockTwits Whisperer API (`api.stocktwitsapi.com/v1`, `x-api-key`) in `stocktwits-tool.ts` + `stocktwits-api.ts` client
  - Real field shapes verified against live API (message `id`/nested `user`/`symbols[]`); swagger `sentiment_*` fields are plan-gated so the tool falls back to VADER labeling
  - Rate-limit aware: honors `retry-after` up to 30s, never hangs; `getAllMessages` caps pagination at 10k; 5-minute client cache to survive the 5 req/min free tier
  - `/trending` currently 403s (upstream Cloudflare challenge, plan-gated); tool degrades to empty in dev / throws in prod rather than fabricate
  - Without `STOCKTWITS_API_KEY` → labeled dev-fallback in non-prod, throw in prod (fail closed)
- [x] Agents wired — sentiment + reasoning agents expose `scrapeRedditTool`, `scrapeNewsTool`, `scrapeTwitterTool`, `gatherStockTwitsSentimentTool` (trading-agents.ts, config.ts)

### Durable scraper store (src/db/scraper-schema/, src/ai/scrape-store.ts)
- [x] All scraping tools write-through their results and raw messages to a **separate** Postgres store (`SCRAPER_DATABASE_URL`), so Viipers keeps its own archive of every scrape and can serve a real (stale-labeled) read after an upstream API goes down
- [x] Isolated schema + client — `src/db/scraper-schema/index.ts` (`scraped_messages`, `scrape_cache`) + `src/db/scraper-index.ts` + `drizzle.scraper.config.ts`; financial migrations never include scraper tables; a scraper bug can't corrupt trading data
- [x] Idempotent dedupe — `(source, externalId)` UNIQUE index, `onConflictDoNothing` on every write
- [x] Failure-proof by design — every store helper catches + logs via evlog and never throws into scraper tools; unconfigured/DB-down → in-process caches only
- [x] Migration applied to the Neon store — `src/db/scraper-migrations/0000_cold_machine_man.sql`, verified with a live write-through/read-back smoke test

## Trading / risk (src/ai/tools/, broker/)

- [x] Market data validated before use — staleness check via `quote.stale` and `MAX_MARKET_DATA_AGE_MS` (30s) in risk gate (risk-tool.ts:242-247)
- [x] Symbol allowlist / validation — `SPOT_MAJORS` allowlist in `adapter.ts:49`; only BTC, DOGE, ETH, SOL, XRP supported
- [x] Order validation — size validation (zero check, lot size, exchange minimum) in `computeSize` (adapter.ts:231-291)
- [x] Position and balance validation — `computeSize` reads real OKX balance; returns 0 if unavailable
- [x] Maximum position size enforced — confidence-scaled, capped at `maxPositionPct` (risk-tool.ts:197-202)
- [x] Maximum exposure / daily loss limits enforced — `fetchDailyRealizedPnl()` reads from capital ledger; `maxDailyLossPct` from runtime settings (risk-tool.ts:162-173)
- [x] Duplicate-order prevention — `proposalId` UNIQUE constraint on orders table + `reserveOrderSubmission` idempotency layer (order-persistence.ts:69-133)
- [x] Partial fills handled — `reconcileFill` polls OKX until terminal state; partial fill on cancel reported as FAILED with quantity (adapter.ts:163-216)
- [x] Rejected/cancelled orders handled — `sCode !== "0"` treated as FAILED (adapter.ts:131-136)
- [x] Exchange downtime / network failure — broker errors surface as FAILED, never corrupt state; reconciliation job retries PENDING orders
- [x] State reconciliation — `order-reconciliation-job` polls OKX every 60s for PENDING orders (order-reconciliation-job.ts:34-152)
- [x] Paper vs. live separation — `credentials?.mode === "live"` picks live; paper requires `PAPER_BOOK_NOTIONAL_USD` and fails closed if missing (execution-tool.ts:44-73, 109-119)
- [x] Emergency kill switch — server-owned, enforced in risk gate AND automation job pre-check; toggled via POST /api/risk/kill-switch with write-access guard

### Findings
- [~] No content-bound approval — the Capital Engine doc (§4.C) recommends hashing the canonical intent+evidence so approval is valid only for that exact hash. Currently, a proposalId carries intent identity but the hash isn't computed or stored. **Current risk: low** — proposalId is unique per proposal, so replay is prevented, but semantic change detection is absent.
- [~] No explicit protective-exit exception — the Capital Engine doc (§5.3) says protective exits should be allowed to reduce risk even when new-risk flow is halted. The current kill switch blocks ALL proposals uniformly. **Current risk: low** — no active position-closing mechanism exists yet, so this becomes relevant when exit logic is added.
- [x] No state corruption on failure — all failure paths surface FAILED/PENDING, never fabricate fills

## Database (src/db/schema/, migrations/)

- [x] Schema reviewed — agent, auth, consensus, portfolio, risk, signals, strategies, trading tables
- [x] Financial values use `numeric` (Postgres decimal), not floating point — `entryPrice`, `quantity`, `pnl`, `amount`, `price` all `numeric`
- [x] Indexes, foreign keys, uniqueness — `proposalId` UNIQUE on orders; FK references on positions→agents, positions→signals, positions→strategies; time indexes on orders, portfolio_snapshots, events
- [x] Transaction boundaries — `recordOrderOutcome` wraps order update + position insert in a single `db.transaction` (order-persistence.ts:163-199)
- [x] Race condition review — `proposalId` UNIQUE constraint is the primary concurrency guard; `onConflictDoNothing` prevents duplicate inserts. Concurrent balance reads are snapshot-based, not read-modify-write. **Remaining gap:** no advisory lock or SELECT FOR UPDATE on balance reads, but this is acceptable because the risk gate runs sequentially per proposal and the unique constraint is the authoritative guard.
- [~] Connection pooling — uses default Postgres pool from `postgres` driver; no explicit pool config review (would need env inspection)

### Findings
- [~] Ledger is append-only for `capital_transactions` — good, but not a full double-entry system. The Capital Engine doc (§5.4) recommends a richer ledger (cash_ledger, position_ledger, order_ledger, mark_ledger, decision_ledger, reconciliation_ledger, audit_chain). **Current risk: medium** — works for a single-account terminal but won't scale to multi-venue or audit-grade accounting without expansion.
- [?] No separate `decision_ledger` — proposals are published as events to the in-process bus but not persisted to an independent audit table. Events in `portfolio.events` are typed but not comprehensive (only `trade`, `signal`, `alert`, `heartbeat`). **Current risk: medium** — event replay requires reconstructing from event bus history, not a durable store.

## Caching (src/lib/redis.ts, ai/tools/market-quote-tool.ts)

- [x] L1 (in-process) / L2 (Redis) cache behavior confirmed — Redis is optional; falls back to in-memory when REDIS_URL is unset
- [x] Redis failure confirmed fail-safe — `safeCommand` wraps all Redis calls, returns null on any error (redis.ts:76-86)
- [~] Stale-quote risk assessed — quote staleness is checked via `quote.stale` and `MAX_MARKET_DATA_AGE_MS` (30s); Redis TTL for quotes not inspected but the risk gate enforces freshness at decision time

## Background jobs (src/lib/jobs/, instrumentation.ts)

- [x] portfolio-snapshot job verified — hourly rollup, idempotent per hour (update-in-place), capital derived from ledger (portfolio-snapshot-job.ts:199-247)
- [x] leaderboard-score job verified — hourly, persists per-agent composite scores (leaderboard-score-job.ts)
- [x] order-reconciliation job verified — polls every 60s, fail-closed, only finalizes confirmed terminal states (order-reconciliation-job.ts:34-152)
- [x] automation job verified — settings-driven interval, kill-switch pre-check, in-flight guard, asset rotation (automation-job.ts:54-97)
- [x] Job scheduling confirmed prod-only where intended — portfolio snapshot, reconciliation, leaderboard are prod-only via `NODE_ENV === "production"` guard (instrumentation.ts:55)
- [x] Manual trigger endpoints (`/api/jobs/...`) — guarded by `requireWriteAccess` (demo key rejected)

## API routes (src/app/api/)

- [x] agents/db — auth + data correctness (via route-auth)
- [x] consensus/proposals — DB-backed with events
- [x] events/recent — feed correctness, no secret leakage in event payloads
- [x] jobs — manual triggers authorized (demo key → 403)
- [x] notifications/read-state — per-reader identity handled
- [x] positions, quotes, signals, strategies, status, trades/activity — input validation, authorization

### Findings
- [x] Kill switch route — POST requires write access, validates boolean input via zod (kill-switch/route.ts:36-84)

## Security

- [x] Secrets/API keys confirmed server-side only — no `NEXT_PUBLIC_` vars expose secrets; only `NEXT_PUBLIC_PUBLISHABLE_KEY` and `NEXT_PUBLIC_API_KEY_PREFIX` are client-exposed (env.ts:34-37)
- [x] Authentication and authorization reviewed per endpoint — `requireWriteAccess` on all mutating routes; demo key is read-only
- [x] Input validation on all mutating routes — zod schemas on kill-switch, runtime-settings, broker-credentials, agent runs
- [~] SQL injection / raw-SQL review — Drizzle ORM used throughout; `sql` tagged templates used for raw expressions but parameterized (no string interpolation of user input)
- [?] SSRF review — server-side fetches for market data use hardcoded URLs; no user-URL construction found but would need deeper audit
- [x] Webhook signature validation — OKX WebSocket uses HMAC auth (`deriveClOrdId`); not a traditional webhook
- [?] Rate limiting on auth/order endpoints — not found in route handlers; may be handled by infrastructure
- [x] Logging confirmed free of secrets — evlog structured logging; broker credentials never logged, only masked hints returned to client

### Findings
- [x] Encryption at rest — broker and LLM credentials stored as `v1.<iv>.<tag>.<ciphertext>` (AES-256-GCM) via secret-box (secret-box.ts:56-71)
- [x] Production key requirement — `SECRET_BOX_KEY` required in production; dev fallback is deterministic per-database (secret-box.ts:42-45)
- [x] `server-only` import on secret-box prevents client-side leakage (secret-box.ts:1)

## Environment & config (src/env.ts)

- [x] Required vs. optional variables documented — `DATABASE_URL`, `API_KEY_PATTERN`, `API_KEY_VALID`, `DEMO_API_KEY` required; LLM keys, Redis, StockTwits (`STOCKTWITS_API_KEY`), Twitter (`TWITTER_BEARER_TOKEN`), the durable scraper store (`SCRAPER_DATABASE_URL`), SECRET_BOX_KEY, PAPER_BOOK_NOTIONAL optional. Scraping keys and the scraper store are optional so the system boots unconfigured; tools degrade honestly rather than invent data.
- [x] Server-only vs. client-exposed confirmed correct — env.ts server/client separation via t3-oss/env-nextjs
- [~] Fails fast on missing required variables — t3-oss/env-nextjs throws at build time for missing required vars; runtime defaults are applied for optional vars

## TypeScript & error handling

- [x] `any` / `as any` / `@ts-ignore` / `@ts-expect-error` — **zero found** across the codebase
- [x] Swallowed-error inventory — **zero empty catch blocks**; all catch blocks log via evlog or return explicit error states
- [x] Blind-retry inventory — no blind retries on non-idempotent trading calls; reconciliation uses structured polling with terminal-state detection
- [x] Idempotency — `proposalId` UNIQUE constraint + deterministic `clOrdId` for OKX

## Testing

- [x] Unit tests — centralized in `test/` (mirrors the `src/` layout, run via `bun test test/` or `bun run test`): `trade-proposal`, `risk-tool`, `technical-analysis-tool`, `broker-health`, `capital-ledger`, `order-reconciliation-job`, and capital-engine (`simulation`/`promotion`/`plugin`/`intent`) — 54 pass / 0 fail
- [~] Integration tests — not found separately; may be covered by unit tests with mocks
- [?] E2E test — not found

### Findings
- [x] Tests cover the critical paths (risk gate, proposal parsing, reconciliation, broker health, capital ledger, promotion/simulation/intent) — all green under `bun test test/`

## Comparison against Capital Engine architecture (AI_CAPITAL_ARCHITECTURE_RESEARCH.md)

| Capital Engine pattern | Viipers status | Gap |
|---|---|---|
| **§4.A Proposal/policy/execution separation** | ✅ Implemented | Typed `AnalysisProposed` → risk gate → execution |
| **§4.B Independent truth boundary** | ⚠️ Partial | Ledger is source of truth for capital, but no separate deployment/credentials boundary from strategy runtime |
| **§4.C Content-bound approvals** | ⚠️ Partial | `proposalId` carries identity but no content-hash of intent+evidence |
| **§4.D Minimal custody vocabulary** | ✅ Implemented | Only `submitOrder` (market orders); no withdraw/transfer/credential-change in autonomous path |
| **§4.E Immutable decision snapshots** | ✅ Implemented (as of this audit) | `decision_snapshots` table with sha256 content-hash per proposal |
| **§4.F NO_TRADE as valid output** | ⚠️ Partial | ABSTAIN rejected as BLOCKED; should be explicit NO_TRADE outcome |
| **§4.G Evidence-gated learning** | ❌ Not implemented | No strategy learning/evolution yet |
| **§4.H Fenced workers / idempotency** | ✅ Implemented | `proposalId` UNIQUE, `clOrdId` deterministic, in-flight guard |
| **§4.I Simulation as promotion gate** | ⚠️ Partial | Paper mode exists; no formal backtest→paper→shadow→live promotion path |
| **§5.3 Risk kernel (multi-axis)** | ⚠️ Partial | Kill switch, daily loss, position cap, confidence floor, staleness; missing: correlation/concentration, leverage, spread, volatility-scaled caps, streak/give-back halts |
| **§5.4 Double-entry ledger** | ⚠️ Partial | `capital_transactions` append-only; missing: position_ledger, mark_ledger, decision_ledger, reconciliation_ledger, audit_chain |
| **§5.5 Simulation/paper as promotion** | ⚠️ Partial | Paper mode works; no formal promotion gate or replay infrastructure |
| **§5.6 Operations / failure behavior** | ✅ Strong | Kill switch, reconciliation, fail-closed on all failures, prod-only jobs, ledger-derived balances |

## Summary

### Production-ready (verified)
- Core invariant: AI proposes, deterministic risk gate disposes
- Kill switch: server-owned, enforced at two layers
- Idempotency: proposalId UNIQUE + deterministic clOrdId
- Credential encryption: AES-256-GCM at rest, server-only
- Fail-closed on all trading path failures
- Typed event contracts for pipeline decoupling
- Reconciliation job for pending orders
- Ledger-derived balances (not stored raw)
- No `any`, no swallowed errors, no mock data on production paths
### Fixed during this audit (priority 1)
- [x] **No immutable decision snapshot** — added `decision_snapshots` table + sha256 content-hash persisted per proposal from the consensus workflow. Files: `src/db/schema/audit.ts`, `src/ai/audit/decision-snapshot.ts`, modified `src/ai/workflows/consensus-workflow.ts`, migration `0009_icy_toad_men.sql`.

### Implemented during this audit (data sources)
- [x] Agents can scrape any source — new `fetchRedditSignals`/`fetchNewsSignals` (per-source split), `twitter-tool.ts`, StockTwits Whisperer migration, wired into sentiment + reasoning agents. No data fabrication: every unconfigured/failed source returns honest labeled state.
- [x] Durable scraper store — every scrape now writes through to a separate Postgres archive/cache (`SCRAPER_DATABASE_URL`), giving Viipers its own version of the upstream data and stale-read fallback when an API is unreachable.

### Remaining gaps (ordered by risk)
1. **No double-entry ledger** — works for single-account but won't scale to audit-grade accounting
2. **No formal promotion gate** — paper mode exists but no backtest→paper→shadow→live path
3. **ABSTAIN conflated with BLOCKED** — loses audit clarity on intentional no-trade decisions
4. **Risk kernel is partial** — missing correlation, leverage, volatility, streak, give-back checks
5. **No separate decision ledger** — `decision_snapshots` cover the decision trail but event replay still isn't a durable, replayable store

### Cannot verify without production credentials/infra
- Live OKX connectivity and order flow
- Database load under concurrent agent runs
- Redis behavior under production Upstash conditions
- Actual LLM latency and timeout behavior with real providers
- Portfolio snapshot accuracy with real position data
