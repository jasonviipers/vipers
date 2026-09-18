# Paper-mode exercise plan (checklist §7 / §10)

Pre-canary gate: run the trading pipeline end to end against the intended
paper venue (Alpaca PAPER API) and review the evidence. Companion to
`POST /api/strategies/paper-venue-verify` (the standing readiness probe) and
§4.6 "Canary capital controls" in the architecture doc.

## Prerequisites

1. **Credentials.** Store Alpaca DEMO-slot credentials in /settings → BROKER
   ACCOUNTS (the probe's 2026-09-18 run in this environment reported
   "no credentials stored" — nothing to verify until these exist).
2. **Readiness probe green.** `POST /api/strategies/paper-venue-verify`
   returns 200: paper route active, account readable, order query
   round-trips, reconciliation surface matches live. Re-run after any
   credential or settings change.
3. **Automation cadence.** `automationEnabled: true` (already the default)
   with a comfortable `automationIntervalSec` for observation.
4. **Lineage.** The consensus plugin's head record sits at PAPER
   (promotion via `POST /api/strategies/plugins/[id]/promote`).
5. **Rollback armed.** `rollbackMaxLossPct` / `rollbackMaxDrawdownPct`
   predeclared in runtime settings — the automatic kill must be live
   during the exercise, exactly as it would be for canary capital.

## Phases

**Phase 1 — readiness (no orders).** Probe green; broker status shows
ALPACA PAPER connected; capital ledger reconciled to the paper venue's
account equity via `POST /api/broker/balance?broker=alpaca` (opening
balance recorded — also satisfies the §10 "ledger opening balance
reconciled to venue balance" gate).

**Phase 2 — supervised paper trading (the exercise).** Let the normal
pipeline run — signal → consensus plugin (isolated worker) → risk gate →
execution tool → Alpaca paper API. No bespoke order injection: paper must
exercise the exact live code path. Expect orders to persist as
`mode: "live"` rows (venue-backed, reconcilable).

**Phase 3 — failure drills (each documented with timestamps).**
- **Stale data:** block market data and confirm the risk gate rejects
  proposals (`stale quote` reason) — never a silent trade.
- **Emergency stop:** arm the global kill switch mid-run; confirm no new
  risk is approved while protective reductions still pass.
- **Per-plugin rollback:** kill the plugin via
  `POST /api/strategies/plugins/[id]/rollback` (reason `operator`);
  confirm HALTED lineage and that the workflow refuses to run it.
- **Auto-rollback:** confirm at least one pass of the rollback monitor
  runs with thresholds armed (dry-run first: `POST
  /api/jobs/strategy-rollback {"dryRun": true}`).
- **Reconciliation:** run the order reconciliation job after every
  uncertain submission and confirm compensating entries, not edits.

**Phase 4 — evidence review.** Assemble the review pack (below) and sign
off in the checklist's sign-off record.

## Evidence pack

- Paper-venue probe output (200, all checks).
- Decision snapshots + decision-ledger rows for the window (hash-verified
  via the replay tooling).
- Orders table export for the window: every row reconciled to a broker
  order id; zero unknown orders.
- Ledger vs venue balance reconciliation report; zero unexplained drift.
- At least one filled and one rejected/reconciled paper order, proving
  lifecycle handling.
- Kill-switch and rollback drill logs.

## Pass criteria

- No unknown orders, no ledger imbalance, no unbounded retries.
- Every risk refusal and every suppression traceable in lineage/ledger.
- Reconciliation drift zero or within documented tolerance.
- Operator sign-off recorded in `CAPITAL_ENGINE_2027_CHECKLIST.md`
  (§7 paper item → [x]; §10 paper-mode gates unblocked).
