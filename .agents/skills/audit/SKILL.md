---
name: viipers-audit
description: Guides audit, hardening, and feature work on Viipers, a multi-agent AI trading terminal (Next.js App Router + Mastra agent swarm + Drizzle ORM/Postgres + TanStack Query + Tailwind). Use this whenever working on the Viipers repo — full production-readiness audits, adding or editing agents/tools/workflows, touching the consensus pipeline (sentiment → analysis → coordination → risk → execution), changing order execution, broker (OKX/paper), or risk-engine logic, editing the Drizzle schema or migrations, reviewing concurrency/idempotency/security around trading, or being asked to make the system "actually work end-to-end" or "production-ready." Also trigger for general automated-trading-system audit requests even when Viipers isn't named, since the same architecture and safety invariants apply. Keeps a living checklist at docs/TRADING_SYSTEM_AUDIT.md and enforces the core rule that AI agents may propose trades but must never bypass the deterministic risk gate.
---

# Viipers Trading System — Audit & Engineering Guide

This skill packages up how to work safely and thoroughly on Viipers: an AI trading
terminal where a swarm of LLM agents (sentiment, technical analysis, reasoning,
orchestration, risk, execution) proposes trades that flow through a mandatory
deterministic risk gate before anything reaches a broker.

The reason this needs its own skill rather than generic "review this code" instincts:
trading systems fail in specific, expensive ways — silent mock data reaching
production, AI output trusted without validation, race conditions doubling
exposure, orders submitted twice, risk checks that can be routed around. Good
general engineering judgment doesn't automatically catch these; the checks below
are written from hard-won incidents in systems like this one.

## Before touching anything

1. Read `references/architecture.md` for the pipeline shape, folder layout, and
   key files — it reflects the repo as documented at the time this skill was
   written. Treat it as a map, not ground truth: confirm against the actual code,
   since the repo will have moved on.
2. Look for `docs/TRADING_SYSTEM_AUDIT.md` in the repo root.
   - If it exists, read it fully before changing anything. It's the record of
     what's already been verified — don't re-litigate items marked `[x]` with
     evidence, and don't silently overwrite someone else's findings.
   - If it doesn't exist and the task is a broad audit or hardening pass, create
     it from `references/checklist-template.md`, adapted to what the code
     actually contains (add/remove sections — the template is a starting point,
     not a fixed form).
   - For a narrow task (one bug fix, one new agent, one PR review), you don't need
     to build the whole checklist file — but if it already exists, update the
     relevant line item when you're done.

## Core principles

These apply whether the task is a full audit or a five-line fix.

1. **Inspect before changing.** Build a mental model of the flow you're touching
   — where a request enters, what validates it, what persists it — before editing.
   Trading code punishes guesses.

2. **The checklist records verified truth, not intentions.** Only mark `[x]` when
   you have concrete evidence (the file, the test, the output). Use `[~]` for
   partial work and `[?]` for anything you can't verify in this environment
   (needs production credentials, a live exchange account, real infra). Never
   check something off because the code merely exists — code existing and code
   working are different claims.

3. **No mock or fake data on production paths.** Grep for `mock`, `fake`, `dummy`,
   `placeholder`, `sample`, `stub`, `TODO`, `FIXME`, hardcoded prices/balances,
   and `Math.random()`-derived PnL or fills. For each hit, decide: legitimate test
   fixture, dev-only shortcut, or a production feature quietly running on fake
   data. The last case is a bug — implement the real thing, don't just delete the
   mock and leave a hole. See `references/audit-methodology.md` for the full list
   of patterns and unacceptable examples.

4. **AI proposes, the deterministic risk engine disposes.** This is the single
   most important invariant in the whole system. The five-stage pipeline already
   encodes it: `risk-agent` is a mandatory gate, and `order-executor-agent` is the
   only component allowed to submit to the broker, and only for `RISK_APPROVED`
   proposals. Any new agent, tool, workflow branch, or "quick path" you add must
   preserve this shape:

   ```
   AI Agent → Trading Intent → Risk Engine → Validation → Execution Engine → Exchange
   ```

   never

   ```
   AI Agent → Exchange
   ```

   If you find (or are asked to add) a path where an agent or tool can reach the
   broker/execution layer without going through the risk gate, treat it as a
   critical finding, not a feature request to fulfill as-is — flag it and propose
   the gated version instead.

5. **Idempotency and concurrency are not optional.** Two agents (or two retries of
   one agent) seeing the same stale balance and both placing orders against it is
   how exposure doubles. Order submission needs an idempotency key; balance/position
   reads-then-writes need real transactions or locks, not read-modify-write races.
   See `references/audit-methodology.md` for the concurrency checklist.

6. **Validate everything crossing a trust boundary.** LLM output (direction,
   confidence, symbol, quantity, order type) is untrusted input — schema-validate
   it, reject malformed output, don't coerce it into looking valid. Same for
   external market data and exchange API responses: don't assume they're
   well-formed just because they came back with a 200.

7. **Fail loud on trading paths.** A swallowed `catch {}` around an order
   submission or a blind retry on a non-idempotent trading call is a bug, not
   resilience. Every important failure (LLM timeout, exchange timeout, DB failure,
   rejected/partial-filled order) needs a deliberate choice: retry, fail,
   compensate, reconcile, alert, or trip the kill switch.

8. **Don't hide problems to make the repo look clean.** Suppressing TypeScript
   errors, deleting or loosening a test, commenting out a failing check, or
   weakening validation to get a green run are all worse than leaving the
   problem visible and documented as unresolved.

## Working through a full audit or hardening pass

1. Inspect the repo (architecture, agents, tools, routes, schema, env vars, jobs,
   tests, and every `TODO`/mock/stub) and build or update
   `docs/TRADING_SYSTEM_AUDIT.md` from `references/checklist-template.md`.
2. Work the checklist one item at a time:
   inspect → classify (complete / partial / broken / missing / mocked / unsafe /
   unknown) → implement the fix → run the smallest relevant test → typecheck →
   update the checklist with evidence → move on.
3. Periodically run the full validation suite the project actually defines
   (check `package.json`/`turbo.json` scripts — this is a Bun project per the
   README: `bun run lint`, `bun run typecheck` or `tsc --noEmit`, tests, `bun run
   build`, plus `db:generate`/`db:push` for schema changes). Don't assume npm.
4. Do a second pass as an adversarial reviewer seeing the repo for the first
   time: hidden mocks, incomplete paths, race conditions, unhandled failures,
   unsafe AI decisions, duplicate orders, stale market data, credential leaks,
   authorization bypasses, silent failures — see
   `references/audit-methodology.md` for the full sweep.
5. Close out `docs/TRADING_SYSTEM_AUDIT.md` with an executive summary: what's
   production-ready, what was fixed, what remains, and — explicitly — what
   can't be verified without production credentials, a live exchange account,
   or deployed infrastructure. Never report a check as passing without having
   actually run it.

## Working a narrower task

Most requests won't be "audit everything" — they'll be "add a new agent," "why
did this order get submitted twice," "review this PR," "add a stop-loss check
to the risk agent." For these:

- Still trace the change through the pipeline stage(s) it touches (see
  `references/architecture.md`) so you know what upstream/downstream code
  depends on it.
- Still apply the core principles above — especially #4 (risk gate can't be
  bypassed) and #6 (validate LLM/external output) — even for a small change.
- Pull the relevant section of `references/audit-methodology.md` (e.g. just
  "Concurrency" or just "Exchange integration") rather than reading the whole
  thing.
- If `docs/TRADING_SYSTEM_AUDIT.md` exists, update the line item your change
  affects; don't leave the checklist stale relative to what you just did.

## Reference files

- `references/architecture.md` — the Viipers pipeline, agents, folder layout,
  event stream, caching, and background jobs, condensed from the project's own
  documentation. Read this first when you need orientation.
- `references/audit-methodology.md` — the full domain-by-domain methodology:
  database/concurrency, exchange integration, environment & secrets, TypeScript
  discipline, error handling, logging/observability, security, Next.js
  boundaries, testing pyramid, and the final adversarial-review sweep. Read the
  section(s) relevant to the task rather than the whole file for small changes.
- `references/checklist-template.md` — a starter `docs/TRADING_SYSTEM_AUDIT.md`
  pre-populated with Viipers' actual components (its five agents, event types,
  DB schema domains, jobs, caching layer). Adapt it as the real code reveals
  more or less than this snapshot assumes.
