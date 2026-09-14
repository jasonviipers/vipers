# Viipers Trading System Audit

Marking convention: `[ ]` not started, `[~]` partial or in progress, `[x]` verified with evidence, `[?]` needs external infrastructure or credentials.

## Executive status

- [~] Repository architecture inspected against `README.md` and the live source tree.
- [x] Production build succeeds (`bun run build`, 2026-09-14; network access was required for Google Fonts).
- [x] TypeScript passes (`bunx tsc --noEmit`, 2026-09-14).
- [x] Lint passes (`bun run lint`, 2026-09-14).
- [~] Automated tests exist only for technical-analysis and risk tools; no project test script, integration suite, or E2E suite is currently configured.
- [~] Database schemas and migrations inspected; migration application requires a PostgreSQL instance.
- [~] Production safety hardening in progress. Do not treat this system as production-ready while any critical item below remains open.

## Architecture and pipeline

- [x] Five-stage flow traced in `src/mastra/workflows/consensus-workflow.ts`: sentiment → analysis → advisory consensus → deterministic risk gate → execution.
- [x] Typed event contracts and runtime bus inspected in `src/mastra/events/` and `src/mastra/runtime/agent-runtime.ts`.
- [~] Risk gate is present and fails closed when ledger/settings reads fail (`src/mastra/tools/risk-tool.ts`), but order reservation/concurrency needs hardening.
- [~] Mastra endpoints now require API-key authentication for reads and write access for all other methods (`src/app/api/ai/[...mastra]/route.ts`); route-level integration coverage is still needed.
- [x] No LLM-reachable order-submission tool remains. The workflow is the only in-repository caller of `placeOrder` (`src/mastra/agents/trading-agents.ts`, `src/mastra/tools/trading-tools.ts`, `src/mastra/workflows/consensus-workflow.ts`; source search, 2026-09-14).

## Trading, execution, and risk

- [x] Asset allowlist is enforced by the live broker adapter for supported OKX spot majors (`src/channels/broker/adapter.ts`).
- [x] Kill switch, daily realized-loss cap, confidence floor, maximum position percentage, and maximum open-position cap are applied by the server risk gate (`src/mastra/tools/risk-tool.ts`).
- [~] Order idempotency is reserved with a durable `PENDING` row before broker submission (`src/mastra/tools/order-persistence.ts`); migration `0006_neat_doctor_doom.sql` must be applied and tested against PostgreSQL.
- [ ] Make order/position persistence atomic and preserve an explicit unresolved outcome for post-submission database failures.
- [~] Live orders use a deterministic OKX `clOrdId` and poll terminal state, but stale/unconfirmed orders require a reconciliation worker.
- [ ] Replace the hard-coded `NOTIONAL_BOOK = 100_000` paper fill stub with a real, explicitly configured paper ledger, or fail closed where a simulated broker is not configured.
- [~] Production now rejects failed market/sentiment/technical fetches instead of honoring `ALLOW_STUB_MARKET_DATA`; compile and unit verification pass, but production failure-path integration coverage is still needed.
- [ ] Validate external market-data, sentiment, and OKX response schemas and apply request timeouts before use.
- [ ] Enforce quote staleness limits before an execution decision; stale cache reads must not reach risk/execution.
- [?] Verify live OKX connectivity, fills, cancellation, partial-fill behavior, and reconciliation with dedicated demo/live credentials.

## Database and concurrency

- [x] Financial database columns use PostgreSQL `numeric` in `src/db/schema/trading.ts` and `src/db/schema/portfolio.ts`.
- [x] `orders.proposal_id` has a unique constraint, but it is currently written too late to prevent concurrent broker submission.
- [~] Strategy child mutations use database transactions (`src/app/api/strategies/[id]/route.ts`); order plus position persistence currently does not.
- [ ] Add and verify execution reservation/finalization transaction semantics and a recovery path for uncertain broker submissions.
- [?] Run migrations and contention tests against PostgreSQL.

## Authentication, authorization, and security

- [x] State-changing first-party routes generally use `requireWriteAccess`; the demo key is read-only (`src/lib/route-auth.ts`).
- [ ] **Critical:** Apply authorization to every Mastra route method; currently `/api/ai` only identifies callers for logging.
- [~] API-key comparison is timing-safe (`src/lib/auth.ts`), but authentication is a single shared key with no user/role model or rate limiting.
- [x] Secrets are modeled as server-only env variables in `src/env.ts`; public variables are limited to the two `NEXT_PUBLIC_` fields.
- [ ] Audit all server fetches for response validation, timeouts, and SSRF/user-controlled URLs.
- [ ] Run dependency vulnerability audit when registry access is available.

## Agents and AI

- [x] Six Mastra agents and their tool bindings reviewed (`src/mastra/agents/`).
- [x] Workflow and manual analysis now share strict Zod parsing; malformed, incomplete, ABSTAIN, and coercible model output is rejected (`src/mastra/agents/trade-proposal.ts`, `trade-proposal.test.ts`; 3 focused tests pass, 2026-09-14).
- [x] Consensus is advisory in the workflow; risk is the intended final authority.
- [ ] Verify configured `maxConcurrency`/`timeoutMs` are actually enforced by the Mastra runtime; current config appears descriptive.

## Observability, operations, and tests

- [x] Structured evlog integration and typed pipeline events are present.
- [~] Critical trading failures are often logged, but no durable reconciliation/alerting path exists for uncertain post-submit outcomes.
- [ ] Verify scheduled jobs, retry limits, graceful shutdown, and health checks.
- [~] Unit tests cover LLM output validation, risk rules, and technical analysis (24 passing assertions/tests in 3 files, 2026-09-14); route authorization, database reservation, and production failure-path coverage remain.
- [ ] Add integration and E2E coverage for risk approval → order reservation → execution → persistence.

## Remaining infrastructure-dependent verification

- [?] PostgreSQL migrations and transaction behavior: requires an available database.
- [?] Google model calls and provider timeout/failure behavior: requires valid provider credentials.
- [?] Redis behavior under outage: requires Redis.
- [?] OKX demo/live behavior: requires exchange credentials and controlled account access.
