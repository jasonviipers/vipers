# Capital Engine 2027 Integration Checklist

Use this checklist as the implementation gate. Do not enable real capital until every **must-pass** item is complete and signed off.

## 0. Scope and evidence

- [x] Record canonical project URLs and current source evidence:
  - Kompany: https://github.com/Fei2-Labs/Kompany — AGPL-3.0; fetched and reviewed in this session.
  - Money Agent: https://github.com/ImmortalDemonGod/money-agent — MIT; fetched and reviewed in this session.
- [~] Resolve reuse scope for Kompany and Money Agent. Both are confirmed as architectural references only unless the human explicitly authorizes a dependency; no code import is permitted yet. Kompany's AGPL-3.0 requires legal review before any dependency or hosted redistribution.
- [ ] Label every capability as `implemented`, `tested`, `observed`, `claimed`, or `unknown`.
- [x] Keep the external project license/reuse record with the integration documentation; no security advisory review has been completed yet.
- [ ] Define supported assets, venues, jurisdictions, and operating hours.

## 1. Domain contracts

- [x] Define `StrategyPlugin` metadata and version contract with schema validation.
- [x] Define typed decision evidence identity with timestamps and content hashes. (Full source/freshness manifest remains pending.)
- [x] Define the initial capital-intent contract with strategy version, instrument, side, evidence identity, and proposal identity. (Sizing/protective-plan fields remain pending.)
- [x] Define explicit `NO_TRADE` outcome with reason text; do not conflate it with an error.
- [x] Define typed `RiskVerdict`: approved, rejected, expired, or unavailable.
- [x] Define execution requests requiring the exact intent hash; risk verdict remains enforced by the workflow gate.
- [x] Define and persist `PromotionRecord` lineage for backtest, shadow, paper, canary, and live states.
- [x] Add focused schema/hash tests for trade proposals and capital intents.

## 2. Strategy plugin boundary

- [x] Create a registry for plugin IDs, versions, capabilities, and required evidence. (Owner metadata remains pending.)
- [x] Make plugin versions/config hashes immutable after publication.
- [~] Add a capability-limited plugin runtime exposing evidence and validated intent output only (`src/ai/capital-engine/plugin-runtime.ts`); module-level import enforcement remains pending.
- [x] Require plugin manifests and capital intents to pass schema validation.
- [ ] Require deterministic fixtures for every plugin.
- [ ] Persist plugin commit/config/model/provider metadata with each decision.
- [ ] Add an explicit strategy disable/rollback operation.
- [ ] Add resource/time budgets and cancellation for plugin execution.

## 3. Evidence and decision ledger

- [x] Persist consensus decisions including `NO_TRADE`, rejection, approval, and order outcomes. (Malformed/no-proposal failures remain pending.)
- [x] Persist the canonical evidence snapshot and SHA-256 content hash for consensus decisions.
- [x] Include policy version, plugin version, model/provider/settings (when supplied), correlation ID, and data timestamps in persisted decision metadata.
- [x] Compute, persist, and enforce an intent/evidence hash before risk and order outcome.
- [x] Add an append-only `decision_ledger` independent of the in-process event bus.
- [x] Add tamper-evident hash chaining or signed audit records.
- [x] Add replay tooling that reconstructs and verifies a stored decision without invoking an LLM or broker. (Historical dataset ingestion remains pending.)
- [x] Test that changing a decision-bearing intent field changes the hash.
- [x] Test duplicate/replayed order and ledger intents are rejected idempotently.

## 4. Double-entry capital ledger

- [x] Add immutable `ledger_accounts` foundation for cash, reserves, inventory, fees, realized P&L, and unrealized P&L.
- [x] Add immutable transaction headers and debit/credit entry schema.
- [x] Enforce balanced entries per currency in the ledger posting primitive.
- [x] Use Postgres `numeric` columns for persisted ledger/accounting values; floating point is limited to validation/read calculations.
- [x] Add order/decision/cash movement, position-lot, mark, reconciliation, and audit-chain ledger foundations.
- [x] Use compensating entries for corrections; prohibit edits/deletes. (Correction posts are append-only and carry `correctionOf` metadata.)
- [x] Add idempotency keys for ledger postings and execution intent hashes for orders.
- [x] Derive risk and portfolio snapshot capital from the independent ledger when populated, with legacy compatibility fallback.
- [x] Create a compatibility projection from broker balance reconciliation into both the independent ledger and legacy `capital_transactions` read model.
- [ ] Reconcile opening balances before switching reads to the new ledger.
- [ ] Test concurrent postings, retries, partial fills, fees, and reversals.

## 5. Risk kernel

- [x] Keep the kernel deterministic and independent of LLM output.
- [x] Enforce stale/missing market-data rejection.
- [x] Enforce the current symbol allowlist. (Strategy mandate registry remains pending.)
- [x] Enforce current max position sizing and exchange order-size limits. (Portfolio-wide notional caps remain pending.)
- [x] Add deterministic leverage, concentration, correlation, and drawdown limit evaluation. (Production data wiring remains pending.)
- [x] Add deterministic volatility and spread limit evaluation; simulation models slippage. (Production liquidity/impact wiring remains pending.)
- [x] Enforce daily loss and drawdown limits. (Rolling loss, streak, and give-back halts remain pending.)
- [x] Enforce duplicate-order/idempotency limits and current open-position caps. (General WIP limit remains pending.)
- [x] Enforce current venue/account kill-switch and instrument allowlist controls. (Per-strategy halt remains pending.)
- [x] Add separate deterministic `new_risk` and `protective_reduction` policy paths, including a dedicated broker reduction adapter.
- [x] Ensure the pure risk policy allows proven protective reductions while new-risk kill switch is armed. (End-to-end broker test remains pending.)
- [x] Add focused boundary tests for current risk limits. (Property-based coverage for every future axis remains pending.)
- [x] Add fail-closed risk behavior and focused coverage for current unavailable-data paths.

## 6. Custody and execution

- [x] Keep broker credentials server-side and encrypted at rest.
- [x] Define a minimal autonomous custody vocabulary through the broker adapter and execution boundary.
- [x] Prohibit autonomous withdrawal, transfer, arbitrary contract call, and credential rotation in the trading execution path.
- [x] Require an exact intent hash and risk-approved workflow path at the execution boundary.
- [x] Keep one execution adapter as the only broker submission path.
- [x] Add deterministic client order IDs and database uniqueness constraints.
- [~] Execution route separation is tested for demo/live/unconfigured modes (`test/ai/capital-engine/execution-mode.test.ts`); venue account identity verification remains pending.
- [x] Fail closed on ambiguous venue/account mode.
- [x] Handle pending, partial, rejected, cancelled, unknown, and terminal fills.
- [x] Reconcile broker state on a schedule and after every uncertain submission.
- [ ] Add scoped credentials/permissions for each venue and account.
- [ ] Add an emergency operator procedure and test it without live capital.

## 7. Simulation and promotion gates

- [ ] Use point-in-time market/news/fundamental data.
- [x] Simulation models fees, spread, slippage, latency, partial fills, and rejects. (Market-impact model remains pending.)
- [x] Simulation uses typed order/fill contracts compatible with execution direction/quantity semantics. (Full shared adapter implementation remains pending.)
- [x] Add deterministic replay/simulation fixtures and a reusable replay contract. (Historical dataset ingestion remains pending.)
- [ ] Run walk-forward and untouched holdout evaluations.
- [ ] Run Monte Carlo/bootstrap and adverse-regime stress tests.
- [ ] Record sample size, turnover, capacity, drawdown, tail loss, and cost sensitivity.
- [ ] Run live-data shadow mode with zero orders.
- [ ] Run paper mode against the intended venue/account behavior.
- [ ] Require operator approval for canary promotion.
- [ ] Set an explicit maximum canary allocation and loss budget.
- [ ] Add automatic rollback triggers and a manual rollback command.
- [x] Make promotion records bind plugin/config/data/policy hashes; plugin registration rejects immutable-version changes.

## 8. Learning and adaptation

- [ ] Store reflections as observations, not executable policy.
- [ ] Version every learned gate, regime model, sizing multiplier, and prompt change.
- [ ] Evaluate proposed changes on holdout/replay data before applying.
- [ ] Require approval for live changes to strategy parameters.
- [ ] Canary learned changes independently from the parent strategy.
- [ ] Grade changes after a predeclared observation window.
- [ ] Automatically roll back changes that violate risk or performance criteria.
- [ ] Prevent learning loops from changing custody permissions or risk ceilings.
- [ ] Distinguish correlation from causal improvement in reports.

## 9. Operations and observability

- [ ] Persist event/audit records outside the in-process event buffer.
- [ ] Add correlation IDs across intent, risk verdict, order, fill, ledger post, and reconciliation.
- [ ] Add alerts for ledger imbalance, reconciliation drift, stale data, unknown order, and kill switch. (Ledger health probe is available for alert wiring; delivery remains pending.)
- [ ] Add health checks for data, model, risk kernel, ledger, broker, and scheduler. (Broker health exists; ledger invariant probe now exists; data/model/risk/scheduler health aggregation remains pending.)
- [ ] Add at-most-one worker/session fencing for each account/strategy deployment.
- [ ] Add bounded retries only for idempotent operations.
- [ ] Add runbooks for broker outage, database outage, duplicate submission, and stuck order.
- [ ] Add daily ledger/reconciliation reports with operator sign-off.
- [ ] Add immutable deployment/build identifiers to every order and decision.
- [ ] Redact credentials, private keys, and sensitive account details from logs.

## 10. Verification gates

### Must pass before shadow mode

- [x] TypeScript check passes.
- [x] Focused lint/format checks pass for the capital-engine integration files. (Unrelated repository-wide findings may remain.)
- [x] Focused unit tests pass for proposal parsing, intent hashing, risk kernel, ledger balancing, promotion, plugin contracts, plugin runtime, and execution-mode separation. (Full reconciliation integration coverage remains pending; latest run: 59 passed.)
- [ ] Integration tests pass with a test database and mocked venue.
- [x] Replay can reconstruct and integrity-check a decision from stored evidence. (It is not an execution authorization path.)
- [~] The runtime boundary exposes no custody or ledger APIs and validates plugin output; static/module-level enforcement and integration coverage remain pending.

### Must pass before paper mode

- [~] Wrong-mode route separation fixtures pass; wrong-account identity fixtures require venue credentials/account probes.
- [x] Simulator handles partial fills, fees, slippage, rejection, and deterministic replay.
- [ ] Reconciliation creates compensating entries rather than overwriting facts. (Cash movements are append-only; fill/position compensating entries remain pending.)
- [ ] Kill switch, protective exit, and stale-data behavior are tested end to end.
- [x] Promotion record persistence and controlled rollback-to-DRAFT/HALTED transitions are operational. (Automated live rollback triggers remain pending.)

### Must pass before canary capital

- [ ] Holdout and stress reports reviewed by an operator.
- [ ] Ledger opening balance reconciled to venue balance.
- [ ] Maximum notional, loss, drawdown, and daily limits are independently tested.
- [ ] Credentials are least-privilege and withdrawal-disabled where supported.
- [ ] Monitoring and alert delivery are verified.
- [ ] Emergency stop and protective reduction have been exercised in paper mode.
- [ ] Canary allocation and automatic rollback thresholds are documented.

### Must pass before scaling live capital

- [ ] Canary results meet predeclared reliability/risk criteria; no post-hoc threshold changes.
- [ ] Reconciliation drift is zero or within a documented, investigated tolerance.
- [ ] No unknown orders, ledger imbalance, or unbounded retry incidents remain open.
- [ ] Strategy and policy hashes are pinned to the promotion record.
- [ ] Operational ownership, review cadence, and incident response are assigned.
- [ ] A fresh independent audit of the capital boundary is complete.

## 11. Suggested implementation order

1. [x] Intent/`NO_TRADE` schemas and content hashing.
2. [x] Durable decision snapshots and stored-evidence replay integrity checks.
3. [x] Double-entry ledger with current broker-balance projection.
4. [x] Risk-kernel expansion and protective-exit path.
5. [x] Strategy plugin registry and versioning.
6. [ ] Simulator/replay/shadow/paper mode contracts.
7. [x] Promotion and rollback workflow foundation.
8. [ ] Reconciliation and operational alerts. (Append-only reconciliation/order-event primitives are implemented; operational alerts remain pending.)
9. [ ] First strategy migration into the plugin boundary.
10. [ ] Canary capital only after all gates above are signed off.

## Sign-off record

| Gate | Owner | Date | Evidence link | Status |
|---|---|---|---|---|
| Domain contracts |  |  |  | ☐ |
| Decision ledger |  |  |  | ☐ |
| Double-entry ledger |  |  |  | ☐ |
| Risk kernel |  |  |  | ☐ |
| Simulation/promotion |  |  |  | ☐ |
| Custody/execution |  |  |  | ☐ |
| Shadow mode |  |  |  | ☐ |
| Paper mode |  |  |  | ☐ |
| Canary capital |  |  |  | ☐ |
| Live scale-up |  |  |  | ☐ |
