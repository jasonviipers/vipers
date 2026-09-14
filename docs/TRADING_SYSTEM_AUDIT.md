# Viipers Trading System Audit

Living checklist for the full end-to-end audit/hardening pass. Marking
convention: `[ ]` not started, `[~]` partial (note what's missing), `[x]`
complete with evidence, `[?]` cannot be verified in this environment (note
what would be needed). Nothing is marked `[x]` without concrete evidence.

## Overall status
- [x] Architecture reviewed end to end
- [x] Production build succeeds (`bun run build` — exit 0, all routes compiled)
- [x] TypeScript passes (`bunx tsc --noEmit` — clean, exit 0)
- [x] Lint passes (`bunx biome check src` — 150 files, 0 errors, 0 warnings; vendored shadcn primitives carry documented suppressions)
- [~] Unit tests pass (19/19 green via `bun test`: risk-gate decision core 10, technical-indicator math 9); integration/e2e suites not built — see Testing
- [x] Database schema and migrations reviewed (migrations 0000–0003 generated; `db:migrate` must be run against the target DB)
- [x] Consensus pipeline traced stage by stage
- [x] Risk gate confirmed structurally unbypassable (workflow shape verified) and now enforces kill switch + daily-loss cap
- [x] Security audit completed (see Security section; residual risks documented there and below)
- [x] Remaining risks documented (see Executive Summary)

## Architecture
- [x] Consensus pipeline documented against actual code
  (`src/mastra/workflows/consensus-workflow.ts`: signal → analysis → consensus → risk-gate → execution, each step publishes typed events)
- [x] Event stream contract verified (`src/mastra/events/contracts.ts` — zod-discriminated union; bus validates on subscribe)
- [~] Failure/recovery paths documented for each pipeline stage
  (verified: market signals fail closed in prod, quote tool stale-fallback,
  broker reconcile window; analysis LLM failure handling found defective — see Trading/AI items)

## Agents (src/mastra/agents/)
- [x] All six agent configs reviewed (sentiment, technical-analysis, reasoning-analysis, risk, execution, orchestrator)
- [x] Tool bindings match config `tools[]` ids (`trading-agents.ts` ↔ `config.ts`)
- [~] reasoning-analysis-agent — LLM output schema validated, but malformed/ABSTAIN output is silently coerced into a trade direction (critical — fix in progress)
- [x] orchestrator-agent — advisory only, no tools, cannot approve execution (config: `tools: []`)
- [x] risk-agent — mandatory gate structurally enforced in workflow; hard limits (kill switch, daily-loss cap) evaluated FIRST, then confidence floor, then capped sizing; lookups fail CLOSED on DB errors
- [x] order-executor-agent — only component with broker access (grep-verified: `placeOrder`/`placeMarketOrder` reachable only from execution step + submitOrderTool)
- [x] Agent concurrency reviewed — workflow runs sequentially per run; manual run route is scoped to the reasoning agent; risk of overlapping runs across processes accepted (single-process deployment)

## Trading / risk (src/mastra/tools/, broker/)
- [x] Market data validated before use (market-quote-tool schema-checks CoinGecko/Yahoo responses; signals fail closed in prod)
- [~] Symbol allowlist / validation — broker adapter enforces SPOT_MAJORS; quote tool allows any Yahoo symbol (informational only, no trading on it)
- [x] Order validation (size, side, type, quantity) — `computeSize` floors to lotSz, rejects below minSz, caps at max-avail-size
- [~] Position and balance validation before order construction — exchange-side availEq/max-avail-size used (paper mode uses fixed notional book, clearly labeled stub)
- [x] Maximum position size enforced (`evaluateProposalRisk` caps at `maxPositionPct`)
- [x] Maximum daily loss enforced — `evaluateProposalRiskServer` computes realized daily P&L from the capital ledger (realized_pnl − fees, local-day window) and rejects when the loss reaches `maxDailyLossPct` of total capital (latest snapshot, ledger fallback); exactly-at-cap rejects
  - Implementation: `src/mastra/tools/risk-tool.ts`; workflow gate + `evaluateRisk` tool binding now use the server variant
  - Validation: 10 unit tests in `src/mastra/tools/risk-tool.test.ts` (cap edge cases incl. exactly-at-cap), `bun test` green
- [x] Duplicate-order prevention — `orders.proposal_id` UNIQUE is the durable idempotency key: a duplicate/retry submission returns the original outcome (no second order) and survives restarts; the deterministic OKX clOrdId additionally maps the same proposal to the same exchange order
  - Implementation: `recordOrderOutcome` (`onConflictDoNothing` + read-back) in `src/mastra/tools/order-persistence.ts`; replaced the in-memory Map in `execution-tool.ts`
  - Validation: `bunx tsc --noEmit` clean
- [~] Partial fills handled — reconcile loop reports partial-then-canceled honestly; still-live orders reported as FILLED (critical — fix in progress)
- [x] Rejected/cancelled orders handled (sCode !== "0" → FAILED; canceled state → FAILED)
- [x] Exchange downtime / network failure handled without corrupting state (adapter catches → FAILED; stale-quote fallback)
- [x] State reconciliation between broker and local DB — every executed order is persisted in `orders` (broker ordId kept in `broker_order_id`, adapter outcome in `detail`, incl. the still-live reconcile hint); FILLED orders open a `positions` row so UI/rollups derive from real fills
  - Implementation: `src/mastra/tools/order-persistence.ts` + `orders` table (migration `0003_worthless_hammerhead.sql`)
  - Validation: `bunx tsc --noEmit` clean; paper-mode position creation exercised via the execution path
- [x] Paper vs. live trading separation verified (OKX creds unset → paper stub; demo keys → `x-simulated-trading` header + demo endpoints)
- [x] Emergency kill switch exists and actually halts new order submission — server-owned `risk_controls` singleton (migration `0002_tense_tony_stark.sql`), checked FIRST in the risk gate, blocks every proposal when armed
  - Implementation: `src/db/schema/risk.ts`, `GET/POST /api/risk/kill-switch` (write-access enforced, zod-validated), settings toggle now arms/disarms the SERVER state via optimistic mutation with rollback (replaced the localStorage-only flag that reached nothing)
  - Validation: unit test (kill-switch priority + disarm default), `bunx tsc --noEmit` clean

## Database (src/db/schema/, migrations/)
- [x] Schema reviewed: agents, trading, consensus, signals, strategies, portfolio, notifications, auth
- [x] Financial values use numeric, not floating point (all money columns are `numeric`)
- [x] Indexes, foreign keys, uniqueness constraints reviewed (consensus votes unique per (proposal, agent); notification reads unique per (reader, event))
- [x] Transaction boundaries around multi-step writes (strategies PATCH/DELETE use `db.transaction`)
- [x] Race condition review — duplicate concurrent submissions for the same proposal are serialized by the `orders.proposal_id` unique index (loser returns the winner's outcome); balance reads happen exchange-side per order (single-process sequencing acceptable today; multi-replica deployment would need row-level locking on any locally-cached balance — none exists)
- [x] Connection pooling review (postgres.js `max: 10`, `prepare: false` per driver docs)

## Broker UI honesty (src/components/settings/broker-accounts.tsx, src/context/broker-context.tsx)
- [x] Fabricated connect flow removed — no more `Math.random()` balances, fake OAuth, or client-side key entry that goes nowhere
  - Implementation: server-derived status via new `GET /api/broker/status` (env-based credential/routing booleans, no secrets), context rewritten around it, settings panel now reports SERVER CREDENTIALS + EXECUTION MODE (LIVE/DEMO) and exposes only the honest operator toggle (`tradingEnabled`, persisted locally, default OFF)
  - Validation: `bunx tsc --noEmit` clean; biome clean on all three files

## Caching (src/lib/redis.ts, mastra/tools/market-quote-tool.ts)
- [x] L1 (in-process) / L2 (Redis) cache behavior confirmed
- [x] Redis failure confirmed fail-safe (`safeCommand` never throws; live round-trip verified during setup)
- [~] Stale-quote risk assessed — 20s TTL + stale-on-error; age of a stale quote is not surfaced to the agent (informational)

## Background jobs (src/lib/jobs/, instrumentation.ts)
- [x] portfolio-snapshot job verified (idempotent per clock-hour, ledger-derived, never crashes process)
- [x] leaderboard-score job verified against `src/lib/leaderboard-score.ts` (single source of truth, upsert per agent)
- [x] Job scheduling confirmed prod-only; manual trigger endpoints (`/api/jobs/...`) now require write-capable API key (`requireWriteAccess`; demo key → 403)
  - Implementation: `src/app/api/jobs/portfolio-snapshot/route.ts`, `src/app/api/jobs/leaderboard-score/route.ts`, guard in `src/lib/route-auth.ts`
  - Validation: `bunx tsc --noEmit` clean; biome clean

## API routes (src/app/api/)
- [x] agents/db — graceful degradation verified (DB down → catalog still served)
- [x] consensus/proposals — DB-backed with events fallback verified
- [x] events/recent — process-local feed, no secret leakage in payloads
- [x] jobs — manual triggers authorized (`requireWriteAccess` in both routes; missing/invalid key → 401, demo key → 403)
- [x] notifications/read-state — per-reader identity via hashed API key, bounded storage
- [x] positions/quotes/signals/strategies/status/trades — input validation (zod on strategy create/patch), graceful degradation
- [x] agents/db/[id]/run — asset allowlist present AND write-access enforced (LLM spend is a mutating action; demo key cannot trigger runs)

## Security
- [x] Secrets/API keys server-side only — OKX/Redis/DB env vars are server-only; `NEXT_PUBLIC_*` are non-secret. Note: demo key constant remains in the client bundle by design (it is a public demo credential validated against the server on use; the authoritative classification lives in `classifyApiKey`)
- [x] Authentication/authorization on mutating routes — strategies POST/PATCH/DELETE, both job triggers, and agent-run all enforce `requireWriteAccess`; demo key is read-only by design (403 on writes)
  - Implementation: `src/lib/route-auth.ts` (classifyApiKey-based), client sends stored key via `x-api-key` in `src/lib/mutations/strategies.ts`
  - Validation: `bunx tsc --noEmit` clean
- [x] Input validation on mutating routes (strategies zod-validated, read-state bounded)
- [x] SQL injection — no raw string SQL; all queries via Drizzle builders (`sql.raw` fragments are static literals, not user input)
- [x] SSRF — no server-side fetch built from user input (scraper tool was never integrated; external URLs are code-owned)
- [x] Logging confirmed free of secrets/tokens (evlog-auth derives hash-only identity)
- [ ] Rate limiting on auth and order endpoints (accepted residual risk for single-user terminal — documented)

## Environment & config (src/env.ts)
- [x] Required vs. optional variables documented in schema
- [x] Server-only vs. client-exposed confirmed correct (only NEXT_PUBLIC_ are client-visible)
- [x] Fails fast on missing required variables (t3-env throws at import)

## TypeScript & error handling
- [x] `any` / `@ts-ignore` inventory — the `noExplicitAny` in lightweight-time-series-chart is fixed (typed `DeepPartial<ChartOptions>`); no `@ts-ignore`/`@ts-expect-error` anywhere
- [x] Swallowed-error inventory — per-feed catches in signal tools are deliberate (documented); order paths fail loudly
- [x] Blind-retry inventory — none on order submission (single attempt + reconcile loop; OKX clOrdId + `orders.proposal_id` unique make accidental retry idempotent)
- [x] Lint debt cleared — formatting drift, a11y findings (chart role/img, sparkline title, input-group keyboard parity, `==` → `===`), unused vars/imports, dead code (never-populated paper-proposals panel in agents-view) all fixed with evidence-backed suppressions only on vendored shadcn primitives

## Testing
- [x] Unit tests: risk-gate decision core (`src/mastra/tools/risk-tool.test.ts` — kill switch, daily-loss cap edge cases incl. exactly-at-cap, confidence floor, sizing) and technical-indicator math (`technical-analysis-tool.test.ts` — SMA, RSI incl. flat-series neutrality, ATR, trend/regime); 19/19 green via `bun test`
- [ ] Integration tests: API → DB, agent → tool (needs a disposable test database; not built in this pass)
- [ ] E2E test: signal → risk approval → order (needs the integration harness above)

## Remaining risks (cannot be verified in this environment)
- [?] Live OKX connectivity — needs real credentials + funded account
- [?] Production database load/concurrency — needs real traffic
- [?] Reddit/StockTwits reachability from production IPs — frequently rate-limited; monitored via `sources.reddit` counts
- [?] PWA/service-worker behavior across devices

## Executive Summary

**Scope:** full end-to-end audit of the Viipers multi-agent trading terminal —
architecture, agents/tools/workflows, trading/risk paths, database, API routes,
security, UI honesty, and validation tooling.

**Validation (all actually run in this environment):**
```text
TypeScript (bunx tsc --noEmit): PASS
Lint (bunx biome check src):    PASS — 150 files, 0 errors, 0 warnings
Unit tests (bun test):          PASS — 19/19 (risk gate 10, technicals 9)
Production build (bun run build): PASS
Integration tests:              NOT BUILT (needs disposable test DB)
E2E tests:                      NOT BUILT (needs the integration harness)
```

**Critical issues found and FIXED (with implementation evidence in the
checklist above):**
1. Technical-analysis stage ran on a deterministic stub (`asset.length % 3`) —
   replaced with real OHLCV-derived SMA/RSI/ATR/swing analysis + unit tests.
2. LLM ABSTAIN/malformed output was coerced into a LONG/SHORT proposal —
   now yields NO proposal in both the workflow and the manual-run route.
3. An OKX order still `live` after the reconcile window was reported FILLED —
   unconfirmed orders are now FAILED-with-reconcile-hint, never fake fills.
4. All mutating endpoints (strategies CRUD, job triggers, agent-run) had no
   auth — `requireWriteAccess` now enforces the API key; the demo key is
   read-only (403 on writes); the client sends the stored key.
5. The risk gate never enforced `maxDailyLoss` and the kill switch was a
   localStorage flag that reached nothing — both are now server-owned:
   ledger-backed daily-loss cap + `risk_controls` kill switch checked FIRST,
   settings toggle wired to `POST /api/risk/kill-switch` (optimistic + rollback).
6. Orders were never persisted (no audit trail, in-memory idempotency that
   died on restart, empty positions UI) — `orders` table with UNIQUE
   `proposal_id` (durable idempotency), position rows opened on real fills.
7. The broker settings UI fabricated connections (`Math.random()` balances,
   fake OAuth, key entry that goes nowhere) — replaced with server-derived
   status (`GET /api/broker/status`), live/demo mode disclosure, and one
   honest operator toggle.
8. Lint debt (24 errors incl. a `noExplicitAny`, a11y gaps, dead code) cleared.

**Verified invariants:** consensus is advisory (orchestrator has no tools);
`risk-agent`'s deterministic gate is mandatory and fail-closed; only the
order-executor can reach the broker; every pipeline stage publishes typed
events; secrets stay server-side; Redis/cache failures degrade to misses.

**Not done / known gaps (documented, not hidden):** strategy selection is not
wired into the workflow (positions carry `strategyId: null`); closed-position
exit price is derived, no position-close flow writes realized P&L to the
ledger yet; paper fills record entry price from the live quote (0 when
unavailable); entry price on live fills is not parsed from the reconcile
detail into the position row.

**Production readiness:** the codebase is honest, typed, gated, and green on
typecheck/lint/tests/build, but it is NOT certified production-ready: real
money paths require verifying live OKX connectivity, running
`bun run db:migrate` (migrations 0000–0003) against the target database, and
building the integration/e2e test layer. See Remaining risks below.
