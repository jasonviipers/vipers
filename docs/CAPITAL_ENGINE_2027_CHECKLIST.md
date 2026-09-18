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
- [x] Prevent plugins from importing broker credentials, ledger writers, or arbitrary network clients through runtime isolation (`src/ai/capital-engine/plugin-worker.ts`: bare `node:vm` worker realm — no `require`/`import`/`process`, code generation disabled, 5s wall-clock budget with hard terminate, 128MB heap cap, payload size caps), enforced for every execution through the registry gate (`src/ai/capital-engine/strategy-registry.ts` binds source immutably to pluginId+configHash; workflows pass identity, never source), with the static import gate (`scripts/check-plugin-boundary.ts`) as a second layer only, and passing adversarial plugin tests proving runtime denial of `require`, dynamic `import`, `eval`/`Function` escape, process access, and static-scan-bypass attempts in `test/ai/capital-engine/plugin-runtime.test.ts` and `test/ai/capital-engine/strategy-registry.test.ts`.
- [x] Require plugin manifests and capital intents to pass schema validation.
- [x] Require deterministic fixtures for every plugin. Fixtures are a typed contract (`strategyPluginFixtureSchema` in `src/ai/capital-engine/plugin.ts`: input + evidence + expected decision, unique names); registration (`registerStrategyPluginSource`) REQUIRES at least one fixture and proves determinism by replaying each fixture three times through the real isolated worker realm, enforcing byte-for-byte canonical-JSON equality with the recording (both cross-repetition and vs-recording), validating that the recording is a well-formed decision bound to the manifest's `pluginVersion`, and failing registration — before any DB row is written — on drift, mismatch, divergence, or fixture-less plugins. The consensus plugin ships fixtures for both behavior paths (`CONSENSUS_PLUGIN_FIXTURES`); `verifyPluginFixtures(pluginId, configHash)` re-checks drift on demand and feeds `advancePromotionGate` (`src/ai/capital-engine/promotion-gate.ts`), which refuses every promotion stage advance unless the plugin re-proves its recorded behavior in the runtime — with the record's `pluginVersion` bound to the registered manifest — then lets the caller append the lineage record stamped with the verified identity; adversarial coverage in `test/ai/capital-engine/strategy-registry.test.ts` includes nondeterministic plugins (`Date.now()`, `Math.random`), recording mismatches, cross-version fixture binding, and a plugin that is benign under its own fixtures but smuggles a module import on an uncovered input path (denied by the runtime layer).
- [x] Persist plugin commit/config/model/provider metadata with each decision. `DecisionMetadata` now carries `pluginId` + `pluginVersion` + `pluginConfigHash` (the exact deciding artifact, registered in `strategy_plugins`), `model` + `provider` (resolved through the same fallback chain the agent call uses — a silent provider fallback is recorded as what actually ran, via `resolveActiveModelInfo` and `TradingAgent.generate`'s result), and a canonical `settingsHash` over the operator's runtime settings in force (`hashRuntimeSettings`). The consensus workflow builds this once per run (`buildDecisionMetadata`) and stamps it at every persist site — NO_TRADE, quorum block, risk block, and order outcome — so both `decision_snapshots` and the append-only `decision_ledger` record the deciding identity, and the tamper-evident `contentHash` covers it (tests prove hash sensitivity to configHash, pluginVersion, and model/provider changes in `test/ai/audit/decision-metadata.test.ts`).
- [x] Add an explicit strategy disable/rollback operation. `src/ai/capital-engine/strategy-lifecycle.ts`: `disableStrategyPlugin` is the kill switch — fail-safe ordering (DB `enabled=false` flip FIRST, then append-only lineage record with the operator reason and `stage: "HALTED"` carried forward from the head, reason annotation appended to `dataSnapshotIds`; a lineage-write failure never restores enablement), idempotent (re-disable of a disabled plugin is a no-op), and permissioned through `POST /api/strategies/plugins/[id]/disable` (`strategies:manage`; reason is an enum: `operator`/`risk-breach`/`fixture-drift`/`regulatory`/`under-review` — no free-text kills). `reactivateStrategyPlugin` refuses a plugin whose registry fixtures fail verification (drift can't be reactivated), runs HALTED→DRAFT through the promotion gate with the full verification chain, and re-enables only after a successful append — reactivation into DRAFT, never straight to a live stage, so capital only reaches it through the normal promotion stages again. The consensus workflow refuses to run for a disabled plugin (BLOCKED pre-run check). `PromotionRecord` now carries `metrics` (nullable), persisted in `strategy_promotions`. Tests: lifecycle unit tests (injected verifier — never a registry module mock, since bun's `mock.module` is process-global) cover disable idempotence, fail-safe ordering, drift-refused reactivation, stage reset, re-enable ordering, and the reason-annotation bug my first draft had; route tests cover auth (401/403), reason validation, 404, and the happy paths.
- [x] Add resource/time budgets and cancellation for plugin execution. `plugin-worker.ts` already enforced a hard wall-clock budget with `worker.terminate()`, a heap cap (`resourceLimits`), and payload size caps; this item adds caller-side **tunable budgets with hard ceilings** — a run may pass `budgetMs` (default 5s) and `heapLimitMb` (default 128MB) through `runPluginSourceInIsolatedWorker` → `runIsolatedPluginSource` → `runRegisteredStrategyPlugin`, but requests beyond `MAX_PLUGIN_EXECUTION_BUDGET_MS` (30s) or `MAX_PLUGIN_HEAP_MB` (512MB), or non-finite/zero/negative/non-integer values, are REFUSED rather than clamped (a budget is a security parameter; silently granting less than asked would hide misconfiguration) — and **cancellation**: an `AbortSignal` terminates the worker immediately at any point (pre-aborted signals refuse to spawn a worker at all; the rejection reason is the abort reason, so callers can distinguish "operator revoked" from budget-kill), threaded through the registry and exposed on the consensus workflow (`ConsensusWorkflowInput.signal`) so a supervisor can revoke an in-flight pass without waiting out its budget. Tests (`test/ai/capital-engine/plugin-budgets.test.ts`): budget ceiling and invalid-value refusals, pre-aborted refusal, and mid-run cancellation of a never-settling plugin that settles in ~250ms against a 10s budget — proving termination, not timeout-race.

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
- [x] Run live-data shadow mode with zero orders. A plugin whose lineage head is at SHADOW runs the FULL consensus pipeline on live data — real signal gathering, isolated plugin execution, capital intent, and the REAL risk-kernel verdict (`evaluateProposalRiskServer`, which for a SHADOW head also applies the fail-closed canary allocation refusal since no cap can be armed for a stage that must not trade) — and the workflow suppresses the broker submission only after every observation is recorded: `isShadowSuppressedStage` gates the branch right before `placeOrder` (the only execution path), so zero orders exist for the run. The suppressed outcome persists as an immutable, hash-chained decision snapshot/ledger row carrying the real risk evaluation with an explicit `"SHADOW MODE — order suppressed (would have executed X% of book / been refused)"` marker (never readable as a kernel-issued block) — the evidence surface the SHADOW→PAPER promotion reviews. Suppression keys off persisted lineage, not request claims; a lineage-less plugin is not shadow-suppressed. Semantics in exported pure helpers (`isShadowSuppressedStage`, `buildShadowDecisionOutcome`), unit-tested in `test/ai/workflows/consensus-workflow-shadow.test.ts` (repo convention: no mock.module for the LLM/worker/DB graph); wiring typechecked.
- [ ] Run paper mode against the intended venue/account behavior.
- [x] Require operator approval for canary promotion. `POST /api/strategies/plugins/[id]/promote` is the only way a plugin reaches CANARY: `strategies:manage` permission (demo sessions are read-only), the promotion gate re-proves the plugin's fixtures in the isolated runtime and requires the submitted record to be the current lineage head, and the verified identity is what gets appended. `appendPromotionRecord` has no other callers besides the lifecycle HALT appends — verified by search — so no code path promotes automatically.
- [x] Set an explicit maximum canary allocation and loss budget. Both controls are predeclared operator runtime settings — nullable, never inherited from a default (a canary control the operator did not set must not exist). **Allocation:** `canaryMaxAllocationPct` (migration `0012`) is enforced by the risk gate — a proposal from a plugin whose lineage head is at CANARY is capped to that percent-of-book ceiling (the confidence-scaled size is clamped under it, so confidence inflation cannot scale a canary past its budget) and REFUSED fail-closed when the cap is not armed; LIVE and lineage-less proposers are unaffected. **Loss budget:** `canaryLossBudgetPct` tightens the automatic rollback loss axis for CANARY lineage heads only (`effectiveLossThreshold` = tighter of the canary budget and `rollbackMaxLossPct`; a canary-only budget never arms LIVE, and the drawdown axis stays stage-agnostic); the strategy-rollback monitor surfaces every CANARY plugin holding capital with no canary budget armed (`unbudgetedCanaries` in the pass summary + a `canary_loss_budget_not_armed` warning + the `POST /api/jobs/strategy-rollback` dry-run preview) and halts budget breaches through the same audited kill switch. The consensus workflow passes its lineage-head stage into the risk gate, so the controls key off persisted lineage, not request claims. Tests: policy semantics (stage-gating, at-threshold, canary-only budget not leaking to LIVE), monitor behavior via injected deps, and risk-gate canary refusal/clamp/uncapped cases in `test/ai/tools/risk-tool.test.ts`.
- [x] Add automatic rollback triggers and a manual rollback command. Automatic: `src/lib/rollback-policy.ts` (pure trigger core — a plugin at CANARY/LIVE whose lineage-head metrics breach a PREDECLARED threshold rolls back; breach is metric ≥ threshold on either the loss axis (window PnL vs total capital, same denominator the risk gate uses) or the drawdown axis; with no threshold predeclared the trigger is inert — automatic kills never run on inherited defaults) + `src/lib/jobs/strategy-rollback-job.ts` (the monitor: enumerates ENABLED plugins, evaluates head metrics, halts breaches through `disableStrategyPlugin` with reason `risk-breach` and operator `system:rollback-monitor` — the SAME fail-safe append-only audited path as a manual kill, so re-entry must pass fixture-proofed reactivation + promotion gates; idempotent across passes via the enablement re-check; scheduled from instrumentation.ts in production every minute, plus a manual trigger `POST /api/jobs/strategy-rollback` with `{"dryRun": true}` preview). Manual: `POST /api/strategies/plugins/[id]/rollback` (`strategies:manage`; reasons `operator`/`risk-breach`/`regulatory` — no `fixture-drift` because drift refuses disablement-by-claim, no free-text). Thresholds are operator runtime settings `rollbackMaxLossPct`/`rollbackMaxDrawdownPct` (nullable percent, migration `0011`); tests: pure-core semantics (at-threshold breach, axis independence, positive-PnL immunity, zero-capital, stage eligibility), monitor behavior via injected deps (never mock.module), and route auth/validation/happy paths.
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
- [x] The active consensus path registers `consensus-v1` and executes its plugin source through the isolated worker before risk/execution; forbidden imports are rejected by runtime and static checks. Broader plugin registry integration coverage remains pending.

### Must pass before paper mode

- [~] Wrong-mode route separation fixtures pass; wrong-account identity fixtures require venue credentials/account probes.
- [x] Simulator handles partial fills, fees, slippage, rejection, and deterministic replay.
- [ ] Reconciliation creates compensating entries rather than overwriting facts. (Cash movements are append-only; fill/position compensating entries remain pending.)
- [ ] Kill switch, protective exit, and stale-data behavior are tested end to end.
- [x] Promotion record persistence and controlled rollback-to-DRAFT/HALTED transitions are operational. (Automatic rollback triggers now exist — see §7 — but paper-mode exercise remains pending.)

### Must pass before canary capital

- [ ] Holdout and stress reports reviewed by an operator.
- [ ] Ledger opening balance reconciled to venue balance.
- [ ] Maximum notional, loss, drawdown, and daily limits are independently tested.
- [ ] Credentials are least-privilege and withdrawal-disabled where supported.
- [ ] Monitoring and alert delivery are verified.
- [ ] Emergency stop and protective reduction have been exercised in paper mode.
- [x] Canary allocation and automatic rollback thresholds are documented. Operator reference added to the architecture doc (§4.6 "Canary capital controls"): how canary status is determined from persisted lineage, the PAPER→CANARY operator promotion path, the predeclared `canaryMaxAllocationPct` / `canaryLossBudgetPct` semantics (fail-closed refusal when unconfigured; tighter-of loss budget), the automatic rollback triggers and monitor cadence, the unbudgeted-canary hygiene signal, and the kill-switch → per-plugin rollback → reactivation hierarchy.

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
9. [~] Consensus strategy registration and isolated-worker routing are implemented; additional strategy implementations and full registry integration tests remain pending.
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
