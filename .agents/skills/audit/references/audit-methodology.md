# Audit Methodology Reference

Read the section(s) relevant to the task at hand. This is the detail layer
behind the core principles in the main skill file — use it when doing a full
audit, or when a narrow task touches one of these domains deeply enough to
warrant the full checklist.

## Table of contents

1. No mock/fake data on production paths
2. Database, transactions, and concurrency
3. Exchange / external API integration
4. Environment variables and secrets
5. TypeScript discipline
6. Error handling
7. Logging and observability
8. Security
9. Next.js server/client boundaries
10. Testing pyramid
11. Final adversarial-review sweep
12. Definition of done

---

## 1. No mock/fake data on production paths

Search for: `mock`, `mocked`, `fake`, `dummy`, `placeholder`, `sample`,
`example`, `fixture`, hardcoded prices/balances, simulated fills, `TODO`,
`FIXME`, `stub`, and anything computing a trading value from `Math.random()`.

For each hit, classify it:
- Legitimate test code (fine, leave it).
- Development-only code, clearly gated behind an environment check (fine, but
  verify the gate actually works and can't leak into prod).
- Production code depending on fake data (bug — implement the real thing).
- Genuinely incomplete implementation (bug — implement or explicitly flag as
  `[?]` in the checklist, don't paper over it).

Unacceptable patterns in production code:

```ts
const price = 100;                    // hardcoded price
const balance = 1000;                 // hardcoded balance
return { pnl: Math.random() * 100 };  // fabricated PnL
return mockMarketData;                // mock reaching a real caller
return fakeOrder;                     // fake order reaching a real caller
```

If a production feature currently depends on mock data, replace it with a real
implementation — don't delete the mock and leave the feature silently broken
(e.g. returning `null`, `[]`, or throwing `Not implemented` where real
functionality is expected).

## 2. Database, transactions, and concurrency

This is where trading systems quietly lose money. Review:

- Schema: indexes, foreign keys, uniqueness constraints, nullable fields,
  numeric precision, timestamps.
- Financial values use exact decimal/numeric handling — not floating point —
  anywhere balances, prices, or PnL are accumulated or compared.
- Transaction boundaries: does a multi-step write (e.g. debit balance + insert
  order) happen atomically, or could a crash between steps leave inconsistent
  state?
- The canonical race to look for:

  ```
  Agent A reads balance = 1000
  Agent B reads balance = 1000
  Agent A places an 800 order
  Agent B places an 800 order
  → actual exposure is 1600, against a 1000 balance
  ```

  Fix with real transactions/row locks (pessimistic or optimistic with a
  retry), not read-then-write in application code.
- Idempotency: can the same order be submitted twice (double-click, retry,
  duplicate webhook, agent re-run)? Is there an idempotency key that makes a
  duplicate submission a no-op rather than a duplicate order?
- Connection pooling and leaks: are connections released on every code path,
  including error paths?
- N+1 queries and unbounded scans on hot paths (dashboard polling, event feed).

Tables to pay particular attention to if they exist: orders, positions, trades,
balances, portfolio, agents, agent_runs, strategies, market_data, signals,
risk_events, audit_logs.

## 3. Exchange / external API integration

Never assume an external response is valid just because the request succeeded.
Review, per provider (broker, market data, sentiment sources):

- Authentication, request signing, timestamp/nonce handling if the provider
  requires it.
- Rate limits, retries with exponential backoff, timeouts.
- Schema-validate responses before using them — a 200 with a malformed body is
  still a failure.
- Partial fills, cancellations, rejections — are these distinguished from a
  clean success, and does state (position, order status) reflect reality after
  each?
- Network failures and provider downtime — does the system degrade safely
  (e.g. pause new orders, don't assume "no response" means "not filled")?
- Websocket reconnect behavior and staleness detection for market data — an
  agent trading on a feed that silently stopped updating is a real risk.
- Blind retries on non-idempotent calls (like order submission) are a bug —
  retries must be safe to repeat, which usually means they need an idempotency
  key on the exchange side too, not just locally.

## 4. Environment variables and secrets

Search for `process.env`, `.env*`, `NEXT_PUBLIC_`, and anything with `KEY`,
`SECRET`, `TOKEN`, `PASSWORD`, `PRIVATE_KEY`, `DATABASE_URL` in the name.

- Confirm required vs. optional, and server-only vs. exposed. Any trading API
  credential reaching a `NEXT_PUBLIC_` variable or client bundle is critical.
- Confirm secrets aren't hardcoded, logged, or committed.
- New required config should go through the project's validated env schema
  (`src/env.ts` in Viipers, using `t3-oss/env-nextjs` + zod) so a missing
  required variable fails fast at startup rather than surfacing later as a
  confusing runtime error.

## 5. TypeScript discipline

Run the project's typecheck command and look specifically for `any`, `as any`,
`@ts-ignore`, `@ts-expect-error`, non-null assertions (`!`), and unchecked
external data (LLM output, API responses, DB rows cast without validation).

Fix the underlying type issue rather than suppressing it. If a suppression is
genuinely unavoidable, it needs a comment explaining why — an undocumented
suppression is indistinguishable from someone hiding a real problem.

## 6. Error handling

Look for empty `catch {}` blocks and `catch (error) {}` blocks that don't do
anything with the error. Every failure on a trading-relevant path — LLM
timeout, exchange timeout, DB failure, invalid market data, invalid AI output,
insufficient balance, rejected order, partial fill, auth failure, rate limit,
process crash — needs a deliberate answer to "then what?": retry (only if
idempotent), fail loudly, roll back, compensate, reconcile on next run, alert,
disable the agent, or trip a kill switch. "Log and continue as if nothing
happened" is rarely the right answer for money-moving code.

## 7. Logging and observability

Logs should make the pipeline traceable end to end: agent started → decision
generated → risk check → order submitted → exchange response → order filled →
position updated. Viipers already has `src/lib/evlog.ts` for structured
logging and a typed event bus for pipeline stages — extend those rather than
inventing a parallel logging approach.

Never log API secrets, private keys, auth tokens, or other credentials — check
that error logs in particular don't accidentally dump a request object
containing them.

## 8. Security

- Authorization on every endpoint that can place orders, cancel orders, change
  strategies, change risk limits, change API keys, enable/disable agents, or
  touch funds. These need real access control, not just an API key that's
  merely present.
- Standard web risks: SQL injection (should be moot with a query builder like
  Drizzle used correctly — check for any raw SQL), SSRF (careful with any
  server-side fetch built from user-controlled input, e.g. webhook URLs),
  command injection, XSS, CSRF, path traversal, insecure redirects, prototype
  pollution.
- Webhook validation (signature checks) if the system accepts any inbound
  webhooks.
- Rate limiting and brute-force protection on auth and order-placement
  endpoints.
- Agent privilege boundaries — can one agent's tool access be escalated to do
  something outside its intended role (e.g. a sentiment agent somehow gaining
  execution-tool access)?
- Dependency vulnerabilities — run the project's package-manager audit.

## 9. Next.js server/client boundaries

Confirm trading logic, broker credentials, and DB access stay server-side
(route handlers, server actions) and never leak into client components or
`NEXT_PUBLIC_` config. Review middleware, caching/revalidation choices on data
that must be fresh (positions, balances, quotes), and that error boundaries and
loading states exist for pages that hit live data.

## 10. Testing pyramid

- **Unit**: risk engine rules, order validation, position/PnL/portfolio math,
  agent output schema validation, market-data validation, env/config
  validation.
- **Integration**: API route → service → DB; agent → tool; trading service →
  broker adapter; order → DB; position → portfolio.
- **End-to-end**: a realistic full run — agent enabled → market data received
  → signal generated → risk validated → order generated → broker adapter
  executes → order persisted → position updated → portfolio updated.

Mocks are fine inside isolated tests. They are not fine in production code
paths — don't let a test's mock quietly become the de facto implementation.

## 11. Final adversarial-review sweep

After the checklist is otherwise complete, re-read the codebase as if seeing
it for the first time, specifically hunting for: hidden mocks, fake data,
incomplete paths, race conditions, unhandled failures, unsafe AI decisions
(agent bypassing the risk gate), duplicate orders, stale market data, incorrect
PnL or balances, database inconsistencies, credential leaks, authorization
bypasses, silent failures, unbounded retries, missing timeouts, missing
idempotency, incorrect decimal handling, agent loops, and concurrency bugs.
Fix anything found; don't just note it and move on if it's fixable in the
current session.

## 12. Definition of done

A hardening pass or audit is done when, for the scope you covered:

- The relevant code has actually been inspected, not assumed.
- Production paths contain no fake/mock trading data.
- Typecheck, lint, and tests pass (or every failure is explicitly documented
  with a reason it couldn't be fixed in this pass).
- The AI-proposes/risk-gate-disposes invariant is intact for anything you
  touched or added.
- Idempotency and concurrency concerns on the paths you touched have been
  addressed or explicitly flagged.
- Secrets remain server-side and unlogged.
- `docs/TRADING_SYSTEM_AUDIT.md` (if in scope) reflects reality — items marked
  `[x]` have evidence, items that can't be verified in this environment are
  marked `[?]` with a note on what's needed (production credentials, live
  exchange account, deployed infra), and nothing is claimed to work that
  wasn't actually run.
