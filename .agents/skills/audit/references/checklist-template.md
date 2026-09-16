# Starter template for docs/TRADING_SYSTEM_AUDIT.md

Copy this into `docs/TRADING_SYSTEM_AUDIT.md` when starting a full audit, then
adapt it — add or remove sections once the real code shows what actually
exists. Don't leave placeholder items that don't correspond to real code, and
don't delete items just because they're hard to verify — mark those `[?]`
instead.

Marking convention: `[ ]` not started, `[~]` partial (note what's missing),
`[x]` complete with evidence (file + how it was verified), `[?]` can't verify
in this environment (note what would be needed).

```markdown
# Viipers Trading System Audit

## Overall status
- [ ] Architecture reviewed end to end
- [ ] Production build succeeds (`bun run build`)
- [ ] TypeScript passes (`tsc --noEmit` or project equivalent)
- [ ] Lint passes
- [ ] Unit / integration / e2e tests pass
- [ ] Database schema and migrations verified
- [ ] Consensus pipeline traced stage by stage
- [ ] Risk gate confirmed unbypassable
- [ ] Security audit completed
- [ ] Remaining risks documented

## Architecture
- [ ] Consensus pipeline documented against actual code
      (sentiment → analysis → coordination → risk → execution)
- [ ] Event stream contract verified (SIGNAL_CREATED, ANALYSIS_PROPOSED,
      CONSENSUS_REACHED, RISK_APPROVED/REJECTED, ORDER_SUBMITTED/FILLED/FAILED)
- [ ] Failure/recovery paths documented for each pipeline stage

## Agents (src/ai/agents/)
- [ ] sentiment-agent — inputs, tools, failure handling, retry/timeout
- [ ] technical-analysis-agent — inputs, tools, failure handling
- [ ] reasoning-analysis-agent — LLM output schema validated (direction,
      confidence 0–1, rationale), malformed output rejected not coerced
- [ ] orchestrator-agent — confirmed advisory only, cannot approve execution
- [ ] risk-agent — confirmed mandatory gate, evaluates position size,
      exposure, drawdown; RISK_REJECTED actually halts the pipeline
- [ ] order-executor-agent — confirmed the *only* component with broker
      access; no other agent/tool can reach submitOrder or the broker layer
- [ ] Agent concurrency reviewed (can two runs for the same asset overlap?)
- [ ] Agent state/memory reviewed (does anything persist across runs that
      shouldn't, or fail to persist what should?)

## Trading / risk (src/ai/tools/, broker/)
- [ ] Market data validated before use (staleness, schema)
- [ ] Symbol allowlist / validation
- [ ] Order validation (size, side, type, quantity)
- [ ] Position and balance validation before order construction
- [ ] Maximum position size enforced
- [ ] Maximum exposure / daily loss limits enforced
- [ ] Duplicate-order prevention / idempotency key on submission
- [ ] Partial fills handled and reflected in position state
- [ ] Rejected/cancelled orders handled (not treated as success or silently
      dropped)
- [ ] Exchange downtime / network failure handled without corrupting state
- [ ] State reconciliation between broker and local DB
- [ ] Paper vs. live trading separation verified (no accidental live orders
      from a paper-configured account or vice versa)
- [ ] Emergency kill switch exists and actually halts new order submission

## Database (src/db/schema/, migrations/)
- [ ] Schema reviewed: agents, trading, consensus, signals, strategies,
      portfolio, notifications, auth
- [ ] Financial values use decimal/numeric, not floating point
- [ ] Indexes, foreign keys, uniqueness constraints reviewed
- [ ] Transaction boundaries around multi-step writes (order + balance, etc.)
- [ ] Race condition review: concurrent agents/requests against the same
      balance or position
- [ ] Connection pooling / leak review

## Caching (src/lib/redis.ts, ai/tools/market-quote-tool.ts)
- [ ] L1 (in-process) / L2 (Redis) cache behavior confirmed
- [ ] Redis failure confirmed fail-safe (degrades to cache miss, never throws
      into the caller)
- [ ] Stale-quote risk assessed (how old can a cached quote get before it's
      unsafe to trade on?)

## Background jobs (src/lib/jobs/, instrumentation.ts)
- [ ] portfolio-snapshot job verified (hourly rollup + ledger backfill
      correctness)
- [ ] leaderboard-score job verified against src/lib/leaderboard-score.ts as
      the single source of truth
- [ ] Job scheduling confirmed prod-only where intended; manual trigger
      endpoints (`/api/jobs/...`) authorized appropriately

## API routes (src/app/api/)
- [ ] agents/db — auth + data correctness
- [ ] consensus/proposals — DB-backed with events fallback verified
- [ ] events/recent — feed correctness, no secret leakage in event payloads
- [ ] jobs — manual triggers authorized, not publicly callable in prod
- [ ] notifications/read-state — per-reader identity handled correctly
- [ ] positions, quotes, signals, strategies, status, trades/activity —
      input validation, authorization, correctness

## Security
- [ ] Secrets/API keys confirmed server-side only, none in NEXT_PUBLIC_ vars
- [ ] Authentication and authorization reviewed per endpoint, especially
      order placement/cancellation, strategy changes, risk-limit changes,
      API-key changes, agent enable/disable
- [ ] Input validation on all mutating routes
- [ ] SQL injection / raw-SQL review (Drizzle usage)
- [ ] SSRF review on any server-side fetch built from user input
- [ ] Webhook signature validation (if applicable)
- [ ] Rate limiting on auth and order-placement endpoints
- [ ] Logging confirmed free of secrets/tokens

## Environment & config (src/env.ts)
- [ ] Required vs. optional variables documented
- [ ] Server-only vs. client-exposed variables confirmed correct
- [ ] Fails fast on missing required production variables

## TypeScript & error handling
- [ ] `any` / `as any` / `@ts-ignore` / `@ts-expect-error` inventory and
      justification (or fix)
- [ ] Swallowed-error inventory (`catch {}`, `catch (error) {}` doing nothing)
- [ ] Blind-retry inventory on non-idempotent trading calls

## Testing
- [ ] Unit tests: risk engine, order validation, PnL/portfolio math, agent
      output validation
- [ ] Integration tests: API → service → DB, agent → tool, broker adapter
- [ ] E2E test: signal → risk approval → order → position → portfolio

## Remaining risks (cannot be verified in this environment)
- [ ] Production exchange connectivity — needs live OKX credentials
- [ ] Production database load/concurrency behavior — needs real traffic
- [ ] (add anything else genuinely blocked on infra/credentials)
```
