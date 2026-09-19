# Viipers Trading System Audit

**Audited:** 2026-09-16 (first pass), refreshed 2026-09-19 (second pass covering commits `da7c1ab..HEAD` — 258 files, ~58k insertions — plus uncommitted pre-auth UI fix and Composio channels layer)
**Method:** Code inspection against `AI_CAPITAL_ARCHITECTURE_RESEARCH.md` patterns and the viipers-audit checklist

## Overall status
- [x] Architecture reviewed end to end (including capital-engine promotion gates, broker router, session auth, Composio channels)
- [x] Production build succeeds — `bun run build` completed cleanly on 2026-09-19
- [x] TypeScript passes — `bunx tsc --noEmit` completed with zero errors
- [x] Lint passes — `bun run lint` passes on 304 files (plugin-boundary 0 errors, biome 0 errors)
- [x] Tests pass — `bun test test/` **278 pass / 0 fail** across 35 files (up from 54; new capital-engine, lifecycle, promotion, rollback, PIT, broker-router, session, channels suites)
- [x] Database schema and migrations verified (Drizzle schema review + migrations 0006–0015 reviewed)
- [x] Consensus pipeline traced stage by stage (incl. new SHADOW suppression + decision metadata)
- [x] Risk gate confirmed unbypassable (re-verified post-refactor incl. canary controls)
- [x] Security audit completed (credential handling, session/cookie auth, Composio secrets)
- [x] Remaining risks documented

## Architecture

### Consensus pipeline
- [x] Pipeline documented against actual code — `src/ai/workflows/consensus-workflow.ts`

```
SIGNAL_CREATED → ANALYSIS_PROPOSED → CONSENSUS_REACHED → RISK_APPROVED/REJECTED → ORDER_SUBMITTED/FILLED/FAILED
```

- [x] Event stream contract verified — `src/ai/events/contracts.ts` defines typed schemas for all five events
- [x] Failure/recovery paths documented:
  - Sentiment/technical failures → LLM errors logged, workflow returns BLOCKED
  - LLM parse failure → `parseTradeProposal` returns null → BLOCKED (not coerced)
  - Risk data unavailable → fail-closed rejection (risk-tool.ts)
  - Order persistence failure → PENDING status, reconciliation handles it
  - Broker error → FAILED result, reconciled by order-reconciliation-job

### Core invariant verified
**AI proposes, the deterministic risk engine disposes.** The path is:

```
reasoning agent → typed intent → risk gate → execution
```

No agent, tool, or workflow branch can reach the broker without `RISK_APPROVED`. Re-verified 2026-09-19:

- `consensus-workflow.ts` is the **only** caller of `placeOrder` (grep: `from "../tools/execution-tool"` across `src/`).
- `execution-tool.ts` mandates a content-bound intent: `validateExecutionIntent` requires `intent` + `intentHash` with matching `proposalId`/`asset`/`direction` and a recomputed sha256 hash — an approval cannot be replayed against mutated content. **Closes prior finding §4.C.**
- `placeOrder` routes through `broker-router.ts` → `resolveActiveBrokerRoute` → `okx-broker.ts` or `alpaca-broker.ts`. Both brokers are importable only by `execution-tool.ts` (grep verified); no other module reaches them.

## Agents (src/ai/agents/)

- [x] sentiment-agent — scrapes market signals from Reddit (direct OAuth, or Composio when the operator connection is active), news/RSS, Twitter/X, and StockTwits; every source fails honestly, never fabricates
- [x] technical-analysis-agent — fetches technicals (RSI, trend, patterns, regime); failure returns defaults
- [x] reasoning-analysis-agent — LLM output schema validated via zod; `ABSTAIN` direction is rejected (not coerced to LONG/SHORT); malformed JSON returns null → pipeline blocked
- [x] orchestrator-agent — advisory only; `tools: []`; no broker access
- [x] risk-agent — mandatory gate; kill switch, daily-loss cap, open-position cap, confidence floor, market-data staleness, canary allocation cap, canary loss budget
- [x] order-executor-agent — the ONLY component with broker access; no other agent or tool can reach `placeOrder` or the broker layer
- [x] Agent concurrency reviewed — `maxConcurrency` per agent config; automation job uses in-flight guard
- [x] Agent state/memory reviewed — no cross-run state leakage; runtime status resets per boot

### Findings
- [x] Immutable decision snapshot — `decision_snapshots` table + content-hash builder persist one sha256-hashed snapshot per proposal (approved, rejected, order-outcome, and SHADOW-suppressed variants)
- [~] ABSTAIN treated as BLOCKED — a valid `ABSTAIN` is conflated with malformed output (both return `BLOCKED`). The Capital Engine doc (§4.F) says NO_TRADE should be an explicit, logged, recognized outcome. **Current risk: low** — functionally correct but loses audit clarity.

## Data sources

- [x] Reddit — two paths, both honest:
  - **Direct** (default): `fetchRedditSignals` via r/{cryptocurrency, Bitcoin, ethereum} public JSON or, when `REDDIT_CLIENT_ID`/`REDDIT_CLIENT_SECRET` are set, app-only OAuth against `oauth.reddit.com` (script-app client_credentials, token cached to ~1h before expiry, fetched once per scrape pass; token-fetch failure logs + falls back to the public path). Without credentials: public endpoints + honest block status, never invented data.
  - **Composio** (when operator connects Reddit on /channels): one `REDDIT_SEARCH_ACROSS_SUBREDDITS` call covers the subreddit set with Composio-managed OAuth, immune to the public-endpoint 403 blocks. Unconfigured/unconnected → falls through to the direct path. Empty result / error → logs a warning and falls back; never fabricates posts. (`src/lib/composio.ts`, `market-signals-tool.ts`)
- [x] News/RSS — `fetchNewsSignals` via CoinDesk / Cointelegraph RSS, VADER-scored, cache + stale fallback
- [x] Twitter/X — `fetchTwitterSentiment`: with `TWITTER_BEARER_TOKEN` (or `X_API_BEARER_TOKEN`) queries X API v2 `tweets/search/recent`, VADER-scored, cache + stale fallback; without a token returns `unconfigured: true`, never fabricates tweets; prod fails closed. Every successful fetch writes through to the scraper store (`setScrapeCache` + `storeScrapedMessages`); `fetchTwitterEnrichment` runs in parallel with `fetchMarketSignals` as optional, failure-tolerant context in the consensus workflow + agent run route without altering the combined score
- [x] StockTwits — migrated from the legacy `api.stocktwits.com` public stream to the StockTwits Whisperer API (`api.stocktwitsapi.com/v1`, `x-api-key`)
  - Real field shapes verified against live API; swagger `sentiment_*` fields are plan-gated so the tool falls back to VADER labeling
  - Rate-limit aware: honors `retry-after` up to 30s, never hangs; `getAllMessages` caps pagination at 10k; 5-minute client cache to survive the 5 req/min free tier
  - `/trending` currently 403s (upstream Cloudflare challenge, plan-gated); tool degrades to empty in dev / throws in prod rather than fabricate
  - Without `STOCKTWITS_API_KEY` → labeled dev-fallback in non-prod, throw in prod (fail closed)
- [x] Agents wired — sentiment + reasoning agents expose `scrapeRedditTool`, `scrapeNewsTool`, `scrapeTwitterTool`, `gatherStockTwitsSentimentTool`

### Durable scraper store (src/db/scraper-schema/, src/ai/scrape-store.ts)
- [x] All scraping tools write-through results and raw messages to a **separate** Postgres store (`SCRAPER_DATABASE_URL`), so Viipers keeps its own archive of every scrape and can serve a real (stale-labeled) read after an upstream API goes down
- [x] Isolated schema + client — `src/db/scraper-schema/index.ts` (`scraped_messages`, `scrape_cache`) + `src/db/scraper-index.ts` + `drizzle.scraper.config.ts`; financial migrations never include scraper tables; a scraper bug can't corrupt trading data
- [x] Idempotent dedupe — `(source, externalId)` UNIQUE index, `onConflictDoNothing` on every write
- [x] Failure-proof by design — every store helper catches + logs via evlog and never throws into scraper tools; unconfigured/DB-down → in-process caches only
- [x] Migration applied to the Neon store — `src/db/scraper-migrations/0000_cold_machine_man.sql`, verified with a live write-through/read-back smoke test

## Trading / risk (src/ai/tools/, broker/)

- [x] Market data validated before use — staleness check via `quote.stale` and `MAX_MARKET_DATA_AGE_MS` (30s) in risk gate
- [x] Symbol allowlist / validation — OKX `SPOT_MAJORS` allowlist; Alpaca path accepts equities + crypto with `ALPACA_EQUITIES` mapping to plain tickers, crypto to `BASE/USD` (alpaca-broker.ts)
- [x] Order validation — OKX size validation (zero check, lot size, exchange minimum) in `computeSize`; Alpaca enforces 0 < pct ≤ 100 plus buying-power/holdings gates
- [x] Position and balance validation — real account reads on both brokers; Alpaca LONG reads `equity`/`buying_power`, SHORT reads `getPositions(symbol)` and fails closed on zero holdings
- [x] Maximum position size enforced — confidence-scaled, capped at `maxPositionPct`; canary heads additionally clamped to `canaryMaxAllocationPct`
- [x] Maximum exposure / daily loss limits enforced — `fetchDailyRealizedPnl()` reads from capital ledger; `maxDailyLossPct` from runtime settings
- [x] Duplicate-order prevention — `proposalId` UNIQUE constraint + `reserveOrderSubmission` idempotency layer + deterministic exchange-side ids (`deriveClOrdId` OKX, `deriveAlpacaClOrdId` Alpaca — deterministic per proposalId so exchange retries de-dupe)
- [x] Partial fills handled — `reconcileFill` polls to terminal state on both brokers; partial-then-terminal reported FAILED with quantity; unconfirmed-after-window is FAILED with explicit "NOT confirmed — reconcile manually" hint, never treated as a position (alpaca-broker.ts)
- [x] Rejected/cancelled orders handled — OKX `sCode !== "0"` → FAILED; Alpaca canceled/expired/rejected → FAILED
- [x] Exchange downtime / network failure — broker errors surface as FAILED, never corrupt state; reconciliation job retries PENDING orders
- [x] State reconciliation — `order-reconciliation-job` polls OKX every 60s for PENDING orders
- [x] Paper vs. live separation — OKX: demo creds → paper book / live creds → live API. Alpaca: demo creds → **Alpaca paper API** (real broker API, mode "live" persistence so it's reconcilable) / live creds → live API; unconfigured active broker in prod → blocked, never synthetic (broker-router.ts, execution-tool.ts fail-closed on missing paper notional)
- [x] Emergency kill switch — server-owned, enforced in risk gate AND automation job pre-check; toggled via POST /api/risk/kill-switch with write-access guard
- [x] Canary allocation cap — `CANARY` lineage heads are REFUSED outright when `canaryMaxAllocationPct` is unset (fail closed — canary never inherits live-scale sizing), and sized under the tighter of the scaled size and the canary cap (risk-tool.ts §2c, §5)
- [x] Auto-rollback monitor — `strategy-rollback-job` (prod-only, every 60s) evaluates PREDECLARED thresholds (`rollbackMaxLossPct` / `rollbackMaxDrawdownPct` / `canaryLossBudgetPct`) against capital-bearing lineage heads and halts breaches via the audited kill switch (disable path). Pure decision core in `src/lib/rollback-policy.ts`: null thresholds are never compared against a default — an automatic kill must be deliberately predeclared; at-threshold counts as breach (budget = ceiling). Canary holding capital without its loss budget armed logs `canary_loss_budget_not_armed` warning

### Findings
- [x] ~~No content-bound approval~~ — **FIXED**: `OrderRequest` carries the risk-approved `intent` + `intentHash`; `validateExecutionIntent` recomputes the sha256 and refuses mismatches (execution-tool.ts). Approval is now valid only for the exact approved content.
- [x] ~~No explicit protective-exit exception~~ — **FIXED**: `placeProtectiveReduction` (alpaca-broker.ts) routes protective reductions through the dedicated adapter operation with a position-scoped deterministic client id, never through the new-risk proposal path — an armed new-risk kill switch cannot trap exposure.
- [x] No state corruption on failure — all failure paths surface FAILED/PENDING, never fabricate fills
- [~] **NEW — Behavioral change to note**: `automationEnabled` now defaults to **true** (commit 243c7a6): fresh installs boot with the autonomous consensus loop armed. The kill switch + risk gate are intact and the loop fails closed on missing broker credentials, so the blast radius is bounded — but it is a deliberate product posture change worth operator awareness.

## Database (src/db/schema/, migrations/)

- [x] Schema reviewed — agent, auth, consensus, portfolio, risk, signals, strategies, trading tables; **new since first pass**: backtest datasets/runs (schema/backtest.ts), promotion lineage seq (0008), broker mode slots (0009), plugin lifecycle columns on strategies (0010–0015)
- [x] Financial values use `numeric` (Postgres decimal), not floating point — `entryPrice`, `quantity`, `pnl`, `amount`, `price` all `numeric`
- [x] Indexes, foreign keys, uniqueness — `proposalId` UNIQUE on orders; FK references on positions→agents, positions→signals, positions→strategies; time indexes on orders, portfolio_snapshots, events; promotion lineage sequence enforced via `0008_promotion_lineage_seq.sql`
- [x] Transaction boundaries — `recordOrderOutcome` wraps order update + position insert in a single `db.transaction` (order-persistence.ts)
- [x] Race condition review — `proposalId` UNIQUE constraint is the primary concurrency guard; `onConflictDoNothing` prevents duplicate inserts. Promotion gate adds a per-plugin in-process mutex around the lineage-head check-then-append (promotion-gate.ts), so concurrent stage advances for one plugin serialize; the gate requires a DB-backed lineage reader and refuses stale heads. **Remaining gap:** no cross-process serialization (noted in-module: belongs in the DB layer if multi-instance deployment ever happens); single-process deploy this is atomic per plugin.
- [~] Connection pooling — uses default Postgres pool from `postgres` driver; no explicit pool config review (would need env inspection)

## Caching (src/lib/redis.ts, ai/tools/market-quote-tool.ts)

- [x] L1 (in-process) / L2 (Redis) cache behavior confirmed — Redis is optional; falls back to in-memory when REDIS_URL is unset
- [x] Redis failure confirmed fail-safe — `safeCommand` wraps all Redis calls, returns null on any error
- [~] Stale-quote risk assessed — quote staleness is checked via `quote.stale` and `MAX_MARKET_DATA_AGE_MS` (30s); Redis TTL for quotes not inspected but the risk gate enforces freshness at decision time

## Background jobs (src/lib/jobs/, instrumentation.ts)

- [x] portfolio-snapshot job verified — hourly rollup, idempotent per hour (update-in-place), capital derived from ledger; reads unified USD+USDT cash via `readUnifiedLedgerCash`
- [x] leaderboard-score job verified — hourly, persists per-agent composite scores
- [x] order-reconciliation job verified — polls every 60s, fail-closed, only finalizes confirmed terminal states
- [x] automation job verified — settings-driven interval, kill-switch pre-check, in-flight guard, asset rotation; **note: `automationEnabled` defaults to true for fresh installs since 243c7a6**
- [x] strategy-rollback job verified — prod-only every 60s; evaluates predeclared rollback thresholds against capital-bearing lineage heads (CANARY/LIVE); breach → audited kill-switch disable with `strategy_auto_rollback` evlog audit record carrying all breached reasons; no-op pass when no threshold predeclared
- [x] Job scheduling confirmed prod-only where intended — portfolio snapshot, reconciliation, leaderboard, strategy-rollback are prod-only via `NODE_ENV === "production"` guard (instrumentation.ts); automation heartbeat + startup broker health probe are HMR-safe via globalThis guards
- [x] Manual trigger endpoints (`/api/jobs/...`) — guarded by `requireWriteAccess` (demo key rejected); `backtest`, `walk-forward`, `pit-ingestion`, `strategy-rollback` triggers all guarded

## Capital engine (src/ai/capital-engine/)

- [x] Promotion gate (`promotion-gate.ts`) — the ONLY sanctioned stage transition path. Five ordered checks: well-formed manifest → `verifyPluginFixtures` (deterministic replay through the REAL isolated worker realm, byte-for-byte canonical equality, 3 repetitions) → lineage-head check via required DB-backed reader (stale record refused) → immutable transition policy (`advancePromotion`) → caller-persisted append-only record. Per-plugin in-process mutex serializes concurrent advances.
- [x] Plugin registry (`strategy-registry.ts`) — plugins execute via `runRegisteredStrategyPlugin`: source is resolved FROM the registry by (pluginId, configHash); workflows pass identity, never source. Registration replays fixtures; static safety gate (`assertPluginSourceSafe`) re-checked at registration AND every execution; runtime isolation via worker realm with no require/import/process.
- [x] Strategy lifecycle (`strategy-lifecycle.ts`) — `isStrategyPluginEnabled` gates the consensus workflow BEFORE any spend; unknown/missing row reads as disabled (fail-safe). Disable/rollback/reactivate routes all require `strategies:manage` permission.
- [x] Point-in-time data contract (`point-in-time.ts`) — typed PIT datasets with strict ascending `asOf`, optional `validTo` retractions; `pitValueAt` binary-searches as-of reads and THROWS `PitLeakageError` on lookahead (query before first stamp or into a retracted gap) — the bias guard is a typed error, never a silent nearest-fill. `hashPitDataset` pins dataset identity into promotion records.
- [x] Walk-forward evaluation (`walk-forward.ts`) + backtest runner (`backtest-runner.ts`) — hash-verified PIT-store accessors; covered by `test/ai/capital-engine/{walk-forward,backtest-runner}.test.ts`
- [x] Live-data SHADOW mode — a plugin whose lineage head is at SHADOW runs the FULL pipeline (real signal, isolated plugin execution, capital intent, real risk verdict) but never reaches the broker; the suppressed outcome is persisted with an explicit `SHADOW MODE — order suppressed` prefix so the SHADOW→PAPER evidence shows what the system WOULD have done with zero orders existing (`consensus-workflow.ts`)
- [x] Decision metadata (`decision-snapshot.ts` `buildDecisionMetadata`) — every persist site stamps WHICH plugin (id+version+configHash), WHICH model/provider produced the reasoning, WHICH data timestamps, and WHICH operator settings were in force
- [x] Cancellation — `ConsensusWorkflowInput.signal` aborts in-flight isolated plugin runs (workers terminated immediately); the workflow surface for shutting down or revoking a pass mid-run

## API routes (src/app/api/)

- [x] agents/db — auth + data correctness (via route-auth)
- [x] consensus/proposals — DB-backed with events
- [x] events/recent — feed correctness, no secret leakage in event payloads
- [x] jobs — manual triggers authorized (demo key → 403)
- [x] notifications/read-state — per-reader identity handled
- [x] positions, quotes, signals, strategies, status, trades/activity — input validation, authorization
- [x] **NEW** channels — `GET /api/channels` read-only (Composio toolkit status; any authenticated identity), `POST /api/channels/connect` write-guarded via `requireWriteAccess` (demo/read-only agents → 403); channel slug validated against `CHANNEL_SLUGS` allowlist; Composio errors surface 502/503 with the message, never fabricate links (src/app/api/channels/route.ts, connect/route.ts)

### Findings
- [x] Kill switch route — POST requires write access, validates boolean input via zod

## Security

- [x] Secrets/API keys confirmed server-side only — no `NEXT_PUBLIC_` vars expose secrets; Alpaca key-id/secret, Reddit OAuth secret, X bearer, `SESSION_SECRET`, and the new `COMPOSIO_API_KEY` are all server-only (env.ts)
- [x] Authentication and authorization reviewed per endpoint — dual-layer model with the proxy (`src/proxy.ts`, Next.js 16 middleware, matcher `/api/:path*`) as an optimistic gate plus route handlers re-verifying independently (`src/lib/session-auth.ts`). AuthN via signed HttpOnly session cookie (HMAC-SHA256, 15-min sliding idle TTL / 24h absolute, timing-safe signature compare, Redis-backed revocation best-effort) OR API key (constant-time classified). AuthZ is a separate per-route permission decision (`requireWriteAccess` / `requirePermission`); the demo identity is read-only and rejected 403 on mutation; per-agent keys resolve to per-agent identities (AGENT_API_KEYS). All mutating route handlers verified guarded (grep: every POST/PUT/PATCH/DELETE has requireWriteAccess/requirePermission except notifications/read-state PUT, which uses per-reader identity with idempotent bounded upserts — acceptable).
- [x] Input validation on all mutating routes — zod schemas on kill-switch, runtime-settings, broker-credentials, agent runs, agent-llm, channels connect, plugin promote/disable/rollback/reactivate
- [x] `SESSION_SECRET` required in production (session.ts); dev fallback deterministic per-database, matching the secret-box pattern
- [~] SQL injection / raw-SQL review — Drizzle ORM used throughout; `sql` tagged templates used for raw expressions but parameterized (no string interpolation of user input)
- [?] SSRF review — server-side fetches use hardcoded provider URLs (Reddit OAuth endpoints, Reddit/News/StockTwits/X APIs, Alpaca endpoints, OKX, Composio); no user-URL construction found but would need deeper audit
- [x] Webhook signature validation — OKX WebSocket uses HMAC auth (`deriveClOrdId`); not a traditional webhook. Alpaca REST uses key/secret headers (no HMAC per provider design). Composio SDK handles its own auth (API key).
- [?] Rate limiting on auth/order endpoints — not found in route handlers; may be handled by infrastructure
- [x] Logging confirmed free of secrets — evlog structured logging; broker credentials never logged, only masked hints returned to client

### Findings
- [x] Encryption at rest — broker and LLM credentials stored as `v1.<iv>.<tag>.<ciphertext>` (AES-256-GCM) via secret-box; `SECRET_BOX_KEY` validates format at boot (secretBoxKeySchema) instead of 500ing on first credential save
- [x] Production key requirement — `SECRET_BOX_KEY` and `SESSION_SECRET` both required in production; dev fallbacks deterministic per-database
- [x] `server-only` import on secret-box/session prevents client-side leakage

## Environment & config (src/env.ts)

- [x] Required vs. optional variables documented — `DATABASE_URL`, `API_KEY_PATTERN`, `API_KEY_VALID`, `DEMO_API_KEY` required; LLM keys, Redis, StockTwits (`STOCKTWITS_API_KEY`), Twitter (`TWITTER_BEARER_TOKEN` / `X_API_BEARER_TOKEN`), Reddit OAuth (`REDDIT_CLIENT_ID`/`REDDIT_CLIENT_SECRET`), Composio (`COMPOSIO_API_KEY`), the durable scraper store (`SCRAPER_DATABASE_URL`), SECRET_BOX_KEY (validated), SESSION_SECRET, AGENT_API_KEYS, PAPER_BOOK_NOTIONAL optional. Scraping keys and the scraper store are optional so the system boots unconfigured; tools degrade honestly rather than invent data.
- [x] Server-only vs. client-exposed confirmed correct — env.ts server/client separation via t3-oss/env-nextjs
- [~] Fails fast on missing required variables — t3-oss/env-nextjs throws at build time for missing required vars; runtime defaults are applied for optional vars

## TypeScript & error handling

- [x] `any` / `as any` / `@ts-ignore` / `@ts-expect-error` — **zero found** across the codebase (re-verified 2026-09-19)
- [x] Swallowed-error inventory — **zero empty catch blocks** (re-verified 2026-09-19); all catch blocks log via evlog or return explicit error states
- [x] Blind-retry inventory — no blind retries on non-idempotent trading calls; reconciliation uses structured polling with terminal-state detection
- [x] Idempotency — `proposalId` UNIQUE constraint + deterministic `clOrdId`/`client_order_id` for OKX/Alpaca

## Testing

- [x] Unit tests — centralized in `test/`, run via `bun test test/`: trade-proposal, risk-tool (incl. canary gates), technical-analysis-tool, broker-health, capital-ledger, capital-basis, order-reconciliation-job, decision-metadata, broker-router, alpaca, secret-box-key, rollback-policy, strategy-rollback-job, promotion gate/records/seq, strategy-lifecycle/registry, walk-forward, backtest-runner, point-in-time, paper-venue-verify, plugin-budgets/runtime, consensus-workflow-shadow, lifecycle routes, promote route, channels connect route — **278 pass / 0 fail**
- [~] Integration tests — route-level tests now exist for plugin lifecycle/promote/channels; broker calls remain mock-boundary tests
- [?] E2E test — not found

### Findings
- [x] Tests cover the critical paths (risk gate incl. canary, proposal parsing, reconciliation, broker health, capital ledger/basis, promotion/simulation/intent, rollback policy, PIT contract, walk-forward, channels connect) — all green under `bun test test/`

## Frontend / terminal UX (src/components, src/lib/queries)

- [x] **NEW — Pre-auth gate (2026-09-19)** — one shared source of truth for "is the terminal unlocked" (`terminal-auth-context.tsx`, fed by the SAME session probe that closes the auth modal). When locked: the entire shell + page content is wrapped `inert` + `aria-hidden` under a full-viewport `backdrop-blur-xl` + `bg-black/70` overlay; every protected React Query (status, signals, trades, positions, quotes, events, consensus, agents-db, strategies, notifications) across all 21 consumers is `enabled: authed`, so no pre-auth fetch fires, no 401 is rendered as an error banner, and only the modal is usable. Signed-out is an expected state, never a failure banner. Logged-in behavior is unchanged; genuine post-auth fetch errors still surface their retry/banner.
- [x] Pipeline isolation — the fix touches zero backend/API/jobs/db files and never writes `automationEnabled`; the server-owned autonomous loop runs regardless of browser auth state.

## Comparison against Capital Engine architecture (AI_CAPITAL_ARCHITECTURE_RESEARCH.md)

| Capital Engine pattern | Viipers status | Gap |
|---|---|---|
| **§4.A Proposal/policy/execution separation** | ✅ Implemented | Typed `AnalysisProposed` → risk gate → execution |
| **§4.B Independent truth boundary** | ⚠️ Partial | Ledger is source of truth for capital, but no separate deployment/credentials boundary from strategy runtime |
| **§4.C Content-bound approvals** | ✅ Implemented | `intent` + `intentHash` recomputed and bound at the execution boundary |
| **§4.D Minimal custody vocabulary** | ✅ Implemented | Only `submitOrder` (market orders) + position-reducing `placeProtectiveReduction`; no withdraw/transfer/credential-change in autonomous path |
| **§4.E Immutable decision snapshots** | ✅ Implemented | `decision_snapshots` table with sha256 content-hash per proposal + full decision metadata (plugin/model/settings/data timestamps) |
| **§4.F NO_TRADE as valid output** | ⚠️ Partial | ABSTAIN rejected as BLOCKED; should be explicit NO_TRADE outcome |
| **§4.G Evidence-gated learning** | ❌ Not implemented | No strategy learning/evolution yet |
| **§4.H Fenced workers / idempotency** | ✅ Implemented | `proposalId` UNIQUE, deterministic exchange client ids (OKX/Alpaca), in-flight guard, isolated worker realm for plugin execution |
| **§4.I Simulation as promotion gate** | ✅ Implemented | DRAFT→SHADOW→PAPER→CANARY→LIVE promotion pipeline with verification gate: deterministic fixture replay + lineage-head check + transition policy + append-only records; paper-venue verification; PIT-grounded walk-forward/backtest evidence |
| **§5.3 Risk kernel (multi-axis)** | ⚠️ Partial→improved | Kill switch, daily loss, position cap, confidence floor, staleness, canary allocation cap (fail-closed), canary loss budget (rollback); missing: correlation/concentration, leverage, spread, volatility-scaled caps, streak/give-back halts |
| **§5.4 Double-entry ledger** | ⚠️ Partial | `capital_transactions` append-only, now unified USD+USDT book; missing: position_ledger, mark_ledger, decision_ledger, reconciliation_ledger, audit_chain |
| **§5.5 Simulation/paper as promotion** | ✅ Implemented | Paper mode + shadow mode with real risk verdicts persisted as promotion evidence; formal promotion gate with PIT-hashed datasets |
| **§5.6 Operations / failure behavior** | ✅ Strong | Kill switch, reconciliation, fail-closed on all failures, prod-only jobs, ledger-derived balances, auto-rollback monitor with predeclared thresholds |

## Summary

### Production-ready (verified)
- Core invariant: AI proposes, deterministic risk gate disposes (re-verified 2026-09-19 post Alpaca/router refactor)
- Content-bound approvals: sha256 intent hash verified at the execution boundary
- Kill switch: server-owned, enforced at two layers
- Idempotency: proposalId UNIQUE + deterministic exchange client ids (OKX + Alpaca)
- Credential encryption: AES-256-GCM at rest, server-only, key format validated at boot
- Session/auth: HMAC-signed short-lived cookies, permission-gated routes, route-level re-verification
- Fail-closed on all trading path failures
- Typed event contracts for pipeline decoupling
- Reconciliation job for pending orders
- Ledger-derived balances (unified USD+USDT book, re-anchored on broker switch)
- Canary controls: fail-closed allocation cap in the risk gate + predeclared-threshold auto-rollback monitor
- Promotion gate: deterministic fixture replay + lineage-head enforcement + immutable transitions
- PIT-grounded evaluation: lookahead bias is a typed error, never a silent nearest-fill
- Composio channels layer: write-guarded connect, read-only status, fail-closed Reddit fallback, never fabricates
- Pre-auth terminal gate: single source of truth, full-viewport blur+tint, all protected queries gated, zero pre-auth error UI
- No `any`, no swallowed errors, no mock data on production paths
- Full suite green: lint, tsc, 278/278 tests, `bun run build`

### Fixed during this audit refresh (2026-09-19)
- [x] **Content-bound approvals (§4.C)** — enforced at the execution boundary via intent + recomputed intent hash.
- [x] **Protective-exit exception (§5.3)** — `placeProtectiveReduction` bypasses the new-risk path with a position-scoped deterministic id; kill switch cannot trap exposure.
- [x] **Formal promotion gate (§4.I / §5.5)** — DRAFT→SHADOW→PAPER→CANARY→LIVE pipeline with verification gates, shadow-mode zero-order evidence, strategy lifecycle wired into the consensus workflow.
- [x] **Pre-auth UI bug** — unauthenticated visitors saw "X DATA UNAVAILABLE" error banners from pre-auth 401s, and the overlay only dimmed part of the screen with no blur. Fixed with one shared auth context + full-viewport blur+tint gate + fetch-gating on every protected query.
- [x] **Production build** — `bun run build` completes cleanly (was `?` unverified in first pass).

### Remaining gaps (ordered by risk)
1. **No double-entry ledger** — works for single-account but won't scale to audit-grade accounting (unified USD/USDT cash book landed; position/mark/decision/reconciliation ledgers still absent)
2. **ABSTAIN conflated with BLOCKED** — loses audit clarity on intentional no-trade decisions
3. **Risk kernel is partial** — missing correlation, leverage, volatility, streak, give-back checks (canary axes added since first pass)
4. **No separate decision ledger** — `decision_snapshots` + decision metadata cover the decision trail, but event replay still isn't a durable, replayable store
5. **Promotion gate serialization is in-process only** — per-plugin mutex is process-local; safe for a single-instance deploy, needs a DB-level head constraint before any multi-instance scale-out

### Behavioral changes since first pass (operator awareness)
- `automationEnabled` defaults to **true** for fresh installs (243c7a6) — the autonomous loop starts on first boot. Kill switch + fail-closed risk remain intact; missing broker credentials block orders in production.
- Alpaca is a first-class broker: demo creds → paper API (persisted mode "live" so orders reconcile), live creds → live API. The active broker is a durable runtime setting; switching re-syncs the ledger to the new broker's equity.
- Reddit has two honest paths: direct (public/OAuth) by default, or Composio-managed when the operator connects Reddit on /channels. Both fail loudly, never fabricate.
- Twitter/X scraping moved from the `@xdevplatform/xdk` library to direct `fetch` against X API v2 (dependency no longer installed).

### Cannot verify without production credentials/infra
- Live OKX and Alpaca connectivity and order flow (both adapters are fail-closed and reconciled, but real-order round-trips need live accounts)
- Database load under concurrent agent runs
- Redis behavior under production Upstash conditions (session revocation degradation path fails open by design)
- Actual LLM latency and timeout behavior with real providers
- Portfolio snapshot accuracy with real position data
- Reddit OAuth and Composio Reddit flows against the live APIs (code paths reviewed; credentials not present in this environment)
