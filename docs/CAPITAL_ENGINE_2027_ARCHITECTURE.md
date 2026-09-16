# Capital Engine 2027: Evidence-Based Architecture and Integration Design

**Date:** 2026-09-16  
**Scope:** Forage, Kompany, Money Agent, Gordon, Circuit Agent, TradingAgents, and Agent Boss  
**Repository:** Viipers multi-agent trading terminal  
**Evidence rule:** A README or product claim is marked as a claim unless the repository exposes an implementation, test, or observable execution path. No performance claim is treated as proof of alpha.

## Executive recommendation

**Build the capital engine; reuse selected research, custody, and coordination ideas.** Do not adopt any of the reviewed projects wholesale as the money-moving core.

Keep Viipers' existing boundary—**AI proposes, deterministic policy disposes**—and replace its single-account, append-only capital transaction model with an independent, double-entry, content-addressed ledger and a formal promotion pipeline:

```text
strategy plugin(s)
  -> evidence snapshot
  -> typed intent / NO_TRADE
  -> deterministic risk kernel
  -> signed approval bound to intent hash
  -> execution adapter
  -> broker / venue
  -> reconciliation
  -> independent ledger
```

No LLM, strategy plugin, orchestration graph, dashboard, or broker adapter may be the source of truth for cash, positions, fills, P&L, limits, or promotion status.

## 1. Identity and evidence resolution

| Name supplied | Canonical implementation found | What can be responsibly concluded |
|---|---|---|
| **Forage** | [capinhoooo/forage](https://github.com/capinhoooo/forage) | Autonomous economic-survival agent, not a conventional trading system. Primary money flows are paid services, x402/t402 spending, and DeFi yield/swap operations. |
| **Kompany** | [Fei2-Labs/Kompany](https://github.com/Fei2-Labs/Kompany) | Confirmed general business-agent operating system, not a trading system. README states AGPL-3.0/open-core; use as an architectural reference only unless a human authorizes a dependency and legal review clears AGPL obligations. |
| **Money Agent** | [ImmortalDemonGod/money-agent](https://github.com/ImmortalDemonGod/money-agent) | Confirmed Stripe-money verification study, explicitly not a trading bot. README states MIT; use as an architectural reference for claim/fact separation only unless a human authorizes code reuse. |
| **Gordon** | [general-liquidity/gordon](https://github.com/general-liquidity/gordon) | Local, supervised/optionally autonomous trading harness with a strong policy, approval, audit, and reconciliation story. |
| **Circuit Agent** | [Circuit-LLM/circuit-agent](https://github.com/Circuit-LLM/circuit-agent), plus [circuit-agent-cloud](https://github.com/Circuit-LLM/circuit-agent-cloud) | Solana deterministic scanner/monitor with an LLM outside the hot path, swarm signals, adaptive learning, and a separate off-box signer/cloud custody design. |
| **TradingAgents** | [TauricResearch/TradingAgents](https://github.com/TauricResearch/TradingAgents) | Research-oriented LangGraph multi-agent analysis and simulated-exchange framework. It is not a production custody or accounting system. |
| **Agent Boss** | [markturansky/agent-boss](https://github.com/markturansky/agent-boss) and [4th-engineer/agent-boss](https://github.com/4th-engineer/agent-boss) | Neither is a trading capital engine: one is a shared-memory coordination bus; the other is a multi-tab terminal manager. |

**Important:** There are multiple projects with the same name. “Agent Boss” is not evidence of trading architecture. Kompany and Money Agent are now identity-resolved from human-supplied URLs, but their reuse scope remains open: neither is a ready-made trading dependency, and no code is imported from either. The human must explicitly choose architectural reference versus dependency before any reuse; Kompany dependency use also requires AGPL legal review.

## 2. Actual architectures

### 2.1 Forage

**System shape:** Bun/Fastify backend, TanStack Start frontend, PostgreSQL/Prisma state, Tether WDK wallet modules, MCP tools, x402/t402 payment layer, and a state-driven adaptive loop.

**Money flow**

```text
clients -> x402/t402 paid service endpoints -> Forage wallet
Forage wallet -> paidFetch() -> other services
wallet -> Aave / Compound / Morpho yield
wallet -> Velora swap / bridge paths
```

The README describes eight paid services, stablecoin settlement, multi-chain wallets, yield routing, and agent-to-agent purchases. The money flow is economically richer than a paper trader, but it is primarily **service commerce plus DeFi treasury management**, not a market-strategy capital allocator.

**Decision layers**

1. Lightweight balance/request pre-check.
2. State machine: THRIVING, STABLE, CAUTIOUS, DESPERATE, CRITICAL, DEAD.
3. Context hash to avoid unnecessary LLM calls, with a maximum cache-hit limit.
4. Claude/Groq decision engine selecting bounded actions such as HOLD, yield supply/withdrawal, pricing, cost reduction, intelligence gathering, emergency, or swap.
5. Deterministic protocol/tool execution and state persistence.

**Risk controls**

The repository claims eleven hard-coded guardrails, reserve/runway behavior, gas-aware rebalancing, protocol risk scores, fallback routing, and zero-balance death. These are useful **operating-state controls**, but they are not equivalent to a portfolio risk kernel with exposure, leverage, correlation, market-impact, and venue-reconciliation controls.

**Ledger / independence**

PostgreSQL stores transactions, costs, services, and state; blockchain settlement is externally observable. The evidence does **not** establish an independent double-entry ledger, a tamper-evident decision ledger, or a complete reconciliation ledger. The wallet is the monetary truth for on-chain balances; application records are operational projections.

**Steal:** economic state machine, runway-aware model/cost degradation, context-hash caching, machine-readable paid service discovery.  
**Do not steal:** allowing the agent brain to own a broad wallet/tool surface or treating application logs as accounting truth.

### 2.2 Gordon

**System shape:** local Bun/TypeScript/React/Ink application; Gordon orchestrates a read-only researcher and an execution-only executor. It uses a canonical tool surface, a permission engine, a multi-dimensional risk classifier, a trading constitution, hooks, kill switches, local SQL/event state, and venue adapters.

**Money flow**

```text
user intent -> structured plan -> approval/policy -> venue adapter -> order
venue state -> reconciliation -> local audit/ledger
```

The default `ask` mode requires approval for live exposure increases. `auto` removes the per-order prompt only inside deterministic gates. Protective reductions are treated separately from new-risk increases.

**Decision layers**

1. Natural-language intent and orchestration.
2. Read-only research/backtest.
3. Structured, content-bound plan.
4. Permission engine and lifecycle hooks.
5. Risk classifier and immutable constitution.
6. Approval mode / operator decision.
7. Execution-only tool and reconciliation.

**Risk controls**

The README enumerates leverage, loss, drawdown, concentration, WIP, rate, streak, give-back, thesis, mandate, universe, clean-state, venue/account/instrument/strategy halts, deny-listed money movement, and kill switches. It also reports content-bound approval: change a plan leg and the approval no longer matches.

**Ledger / independence**

Gordon claims HMAC-chained decisions, rationale, portfolio state, orders, and reconciliation, with SQLite audit state and LibSQL/Turso operational state. This is the strongest reviewed design for auditability and control separation. The public description does not prove a full accounting-grade double-entry chart of accounts, nor should HMAC chaining be confused with an independently operated ledger.

**Steal:** plan-first execution, deny-first permissioning, content-bound approvals, protective-exit exception, scoped halts, hooks around money-touching operations, and explicit paper/live caveats.  
**Do not steal:** local-only state as the sole institutional record, broad tool catalogs without capability-level authorization, or claims that backtesting proves an edge.

### 2.3 Circuit Agent and Circuit Cloud

**System shape:** Solana agent with deterministic 60-second dip-reversal scanner and seconds-level position monitor. LLM calls are confined to strategy-session selection, exception escalation, chat, and four-hour reflection. Circuit Cloud separates control plane, node host, agent workload, and signer custody.

**Money flow**

```text
wallet -> Jupiter buy -> position -> Jupiter/Jito sell -> wallet
winning trade -> configured CIRC purchase for API economics
owner wallet -> agent wallet (funding)
```

Circuit Cloud's signer exposes a narrow buy/sell vocabulary; no transfer/withdraw verb is available to the autonomous path. The cloud README describes off-box Ed25519 keys, policy checks, at-most-one session fencing, content-hashed signed bundles, curated environment, sandboxing, and rescheduling after node failure.

**Decision layers**

1. On-chain market/data ingestion and rug filtering.
2. Six-component deterministic candidate score.
3. Swarm consensus/blacklist check.
4. Mode gate: active, selective (LLM gate), or watch-only.
5. Position monitor: stops, take profit, trailing stop, max hold, swarm exits.
6. Periodic LLM strategy loop and reflection learner.
7. Signer re-checks policy and transaction shape before signing.

**Risk controls**

Stop loss, take profit, trailing stop, max hold, entry budgets, score thresholds, regime multipliers, ecosystem-health gating, token allow/deny lists, max SOL per trade/day, cooldown, router allowlist, session epoch fencing, and automatic pause/resume controls are visible in the code/documentation. The project explicitly calls out remaining address-lookup-table validation as a hardening gap.

**Ledger / independence**

The trading agent records append-only JSONL learning/approval logs and on-chain positions are externally verifiable. The cloud design improves custody independence but is not a demonstrated double-entry ledger. A wallet/explorer is not a complete ledger for fees, reservations, intent lineage, marks, rejected orders, or reconciliation decisions.

**Steal:** keep the LLM out of the hot path, narrow signer vocabulary, off-box custody, signed content-addressed bundles, session fencing, protective monitor, and learning behind operator approval.  
**Do not steal:** token economics as a substitute for risk, swarm consensus as authorization, or auto-applied learning without promotion and rollback gates.

### 2.4 TradingAgents

**System shape:** Python/LangGraph research graph with fundamental, sentiment, news/macro, and technical analysts; bullish/bearish researchers; trader; risk manager; and portfolio manager. It supports many model providers, checkpoints, a decision-memory markdown file, and a simulated exchange.

**Money flow**

```text
market/news providers -> analyst graph -> trader proposal
-> risk/portfolio manager -> simulated exchange
```

No live brokerage/custody path is demonstrated in the repository overview. The exchange is explicitly simulated/research-oriented.

**Decision layers**

Analyst specialization, debate between bull/bear researchers, trader synthesis, risk assessment, and portfolio-manager final approval. The graph is valuable as a research workflow, not as a capital boundary.

**Risk controls**

Portfolio and risk-manager reports are part of the graph. The repository also highlights point-in-time/look-ahead fixes, grounded prices, ticker validation, retry budgets, and checkpoint recovery. These are research correctness and workflow reliability controls, not sufficient live execution controls.

**Ledger / independence**

Decision memory is a markdown log and checkpoints are per-ticker SQLite databases. Neither is an independent accounting ledger. The project itself says outcomes vary with model, temperature, data, and periods.

**Steal:** analyst diversity, adversarial debate, typed outputs, point-in-time data discipline, checkpoint resume, and explicit reproducibility caveats.  
**Do not steal:** debate/quorum as a risk approval, markdown memory as audit truth, or simulated returns as live evidence.

### 2.5 Agent Boss

The exact public repositories resolve to coordination infrastructure, not trading:

- **markturansky/agent-boss:** Go HTTP shared blackboard. JSON is canonical; markdown is rendered. It has per-agent channels, header identity checks, spaces, contracts, archive, and optional container isolation.
- **4th-engineer/agent-boss:** Python multi-tab terminal manager for launching CLI agents.

**Steal from the first:** structured canonical state, human-readable projections, explicit agent identity, shared contracts, and compaction-resistant handoffs.  
**Do not claim:** either provides money flow, risk controls, custody, fills, P&L, or an independent ledger.

### 2.6 Kompany and Money Agent

No exact repository could be established from public search results. The correct finding is **not implemented/unknown**, not “simple architecture.” Before integrating either name, require:

- canonical repository or product URL;
- commit/tag to inspect;
- supported asset classes and venues;
- paper/live boundary;
- custody model;
- ledger and reconciliation model;
- reproducible test/demo evidence.

## 3. Cross-project comparison

| Capability | Forage | Gordon | Circuit | TradingAgents | Agent Boss | Viipers today |
|---|---|---|---|---|---|---|
| Primary purpose | Agent economy/DeFi survival | Controlled trading harness | Solana autonomous trader/cloud | Research simulation | Coordination | Multi-agent trading terminal |
| LLM in hot path | Yes, decision loop | Yes for proposal/research; policy is deterministic | No for scanner/monitor | Yes throughout graph | N/A | Yes for analysis, no for deterministic risk |
| New-risk approval | State/guardrail based | Strong ask/auto modes | Mode/config based; signer policy | Portfolio manager in simulation | N/A | Risk gate |
| Protective exits | Emergency/state actions | Explicitly separated | Stops/trailing/swarm exits | Simulated portfolio behavior | N/A | Not yet a dedicated exception |
| Off-box custody | WDK wallet in app | Local keys/accounts | Strong signer boundary | No live custody | N/A | Encrypted broker credentials, same app boundary |
| Independent ledger | Not demonstrated | HMAC audit + SQL; accounting completeness unclear | On-chain truth + logs; no double-entry shown | Markdown/SQLite research state | No | Append-only capital transactions; not double-entry |
| Content-bound approval | Not demonstrated in Forage README | Explicitly demonstrated/claimed | Signed bundles/intents in cloud | Structured outputs, not capital approval | N/A | Proposal identity; content hash only partial |
| Simulation/promotion | Testnet-oriented | Paper/backtest, with caveats | Paper + live modes | Simulated exchange | N/A | Paper mode, no formal promotion gate |
| Learning | Adaptive economic state | Evaluation/memory | Reflection/gates/regime learning | Decision memory | Shared contracts | No evidence-gated learning pipeline |

### What works

1. **Separating proposal from authority** works across Gordon, Circuit Cloud, and Viipers; it is more important than agent count.
2. **Deterministic hot paths** work for Circuit's scanner/monitor and Viipers' risk checks; LLM latency and variability are poor fits for emergency exits.
3. **Content-addressing and fencing** make retries, failover, and approval scope enforceable.
4. **Simulation and replay** make claims inspectable, but only when data is point-in-time, costs are modeled, and the simulator is not confused with live execution.
5. **Human-readable projections over structured canonical state** improve operations without making markdown the source of truth.

### What does not work or remains unproven

- More agents and debate do not create independent risk authority.
- A “risk manager” prompt is not a risk kernel.
- A wallet balance, trade-history file, or event stream is not a complete independent ledger.
- Backtest lifts, small samples, win rate, and live demos do not establish durable alpha.
- Auto-learning that changes thresholds or sizing without approval, canarying, and rollback creates an unbounded change channel.
- “Paper mode” is not proof of live/paper isolation unless venue behavior and account identity are tested.
- Consensus from correlated agents is not diversification.
- A token used to pay for APIs is not a sound business model or a risk control.

## 4. 2027 architecture for Viipers

### 4.1 Core principles

1. **Capital truth is independent.** The ledger runs as a separate module/service boundary with a separate write API and read model; strategies cannot mutate balances.
2. **Every proposal is either a typed intent or explicit `NO_TRADE`.** Abstention is not an exception and is not silently converted to a blocked/error state.
3. **Approvals bind to content.** Canonical intent + evidence + policy version + data timestamps are hashed; changed content requires a new decision.
4. **Risk is deterministic and deny-first.** LLMs may supply evidence and rationale, never limits or final authorization.
5. **The simulation path is first-class.** Backtest, replay, shadow, paper, and live share the same intent/risk/execution contracts.
6. **Learning is evidence-gated.** No strategy or risk-policy mutation reaches live without a versioned evaluation and promotion decision.
7. **Protective reductions survive new-risk halts.** Closing or reducing existing exposure has a narrower, separately audited path.

### 4.2 Components

```text
                         operator / dashboard
                                  |
                         read-only projections
                                  |
 market data -> evidence store -> strategy registry
                                  |                  |
                         strategy plugins       simulator
                                  |                  |
                         typed proposal / NO_TRADE
                                  |
                   decision ledger + approval service
                                  |
                           deterministic risk kernel
                                  |
             +--------------------+--------------------+
             |                                         |
       execution router                         promotion gate
             |                                         |
      paper / shadow / live                 candidate -> approved version
             |                                         |
      venue adapters -> reconciliation -> independent double-entry ledger
                                             |
                                  snapshots / audit chain / reports
```

**Strategy plugin contract:** versioned metadata, universe, timeframe, required evidence, deterministic features, optional LLM analyst, proposal schema, sizing hint (never authority), and evaluator. Plugins cannot import broker credentials, ledger writers, or arbitrary network clients.

**Capital engine contract:** account, strategy version, mode, instrument, side, quantity/notional bounds, entry/exit intent, stop/protective plan, expiry, evidence references, risk policy version, and canonical hash.

**Risk kernel axes:** stale/missing data, max order and position notional, portfolio heat, leverage, concentration, correlation, liquidity/spread/slippage, volatility, daily/rolling loss, drawdown, loss streak/give-back, open-order/WIP limits, venue health, duplicate/replay, mandate/universe, and kill switch.

**Custody vocabulary:** `getBalance`, `placeOrder`, `cancelOrder`, `reducePosition`, and `reconcile`. No autonomous withdrawal, transfer, credential rotation, or arbitrary transaction signing.

### 4.3 Independent auditable ledger

Use Postgres numeric values and database transactions, but keep the ledger API independent from strategy/execution code. Model at least:

- `ledger_accounts`: cash, reserved cash, fees, realized P&L, unrealized P&L, inventory by venue/asset;
- `ledger_transactions`: immutable transaction header, source, idempotency key, timestamp, policy/version references;
- `ledger_entries`: debit/credit rows with asset, quantity, valuation currency, and account;
- `order_ledger`: submitted, acknowledged, partially filled, filled, cancelled, rejected, unknown;
- `position_ledger`: lots, quantity, average cost, realized close attribution;
- `mark_ledger`: timestamped price/evidence source and valuation policy;
- `decision_ledger`: intent, evidence manifest, content hash, proposal, risk verdict, approval, and model metadata;
- `reconciliation_ledger`: venue snapshot, calculated balance, difference, status, operator action;
- `audit_chain`: previous hash, current hash, signer/key version, canonical payload.

Invariants:

- every posted transaction balances per asset and valuation currency;
- ledger-derived cash and positions are never overwritten by a dashboard or broker callback;
- broker data is an external observation that must reconcile, not an unquestioned write;
- every order has an idempotency key and intent hash;
- unknown broker state blocks new risk but permits bounded reconciliation/protective actions;
- corrections are compensating entries, never edits/deletes;
- periodic snapshots are reproducible from the append-only journal.

### 4.4 Promotion path before real capital

```text
plugin draft
 -> deterministic unit tests + fixture replay
 -> historical backtest (point-in-time data, fees, spread, slippage, latency)
 -> walk-forward / holdout / Monte Carlo stress
 -> shadow mode (live data, no orders)
 -> paper mode (venue/account behavior verified)
 -> canary allocation (tiny bounded capital, human approval)
 -> staged promotion with automatic rollback
```

A promotion record must include plugin commit, config hash, model/provider/version, data snapshot IDs, simulator version, risk policy, sample size, drawdown, turnover, costs, tail loss, capacity estimate, and known failure modes. Promotion is invalid if the strategy changes, evidence contract changes, or risk policy changes.

### 4.5 Integration into this repository

Current strengths to preserve:

- `src/ai/workflows/consensus-workflow.ts` stage separation;
- deterministic `risk-tool.ts` gate;
- execution-only `execution-tool.ts` and broker adapter;
- encrypted credentials in `src/lib/secret-box.ts`;
- idempotent `proposalId` order persistence and reconciliation job;
- typed event contracts and decision snapshots;
- paper/live mode separation and kill switch.

Priority changes:

1. Add a `capital-engine` domain around typed intent, policy evaluation, promotion, and mode.
2. Replace `capital_transactions` as the accounting endpoint with the double-entry ledger API; retain a compatibility projection during migration.
3. Add decision-ledger persistence for every proposal, including `NO_TRADE`, rejection, approval, expiry, and order outcome.
4. Compute and persist a canonical SHA-256 intent/evidence/policy hash before risk evaluation and require it at execution.
5. Add strategy plugin registry/versioning and route `strategyId` into the workflow before analysis.
6. Add backtest/replay/shadow/paper promotion states and an operator approval record.
7. Split protective exits from new-risk approvals and make the kill switch block new risk while allowing bounded reductions.
8. Add reconciliation-difference states and alerts rather than treating broker state as a fill fact.
9. Add correlation/concentration/leverage/volatility/spread/streak/give-back controls.
10. Move durable audit writes out of the in-process event bus; events remain notifications, not the audit store.

## 5. Build or reuse decision

### Build

Build the capital engine, ledger, risk kernel, promotion state machine, and Viipers integration. These are domain-specific controls and must be reviewable by the project owner; outsourcing their semantics creates an unacceptable trust boundary.

### Reuse selectively

- **Gordon:** plan-first, deny-first policy, content-bound approvals, protective exits, halt taxonomy, lifecycle hooks.
- **Circuit Cloud:** off-box signer, narrow custody verbs, session epochs, content-addressed bundles, sandboxed workers.
- **Circuit Agent:** deterministic hot-path scanner/monitor, regime sizing as a candidate feature, reflection behind approvals.
- **TradingAgents:** analyst decomposition, bull/bear challenge, point-in-time data discipline, checkpoint/replay patterns.
- **Forage:** runway-aware operating modes, cost-aware model selection, context hashing, machine-readable service contracts.
- **Agent Boss:** structured canonical coordination state and human-readable projections.

### Avoid

- Reusing any project as a drop-in live-money executor.
- Letting an LLM decide limits, approve its own order, or call an unrestricted wallet.
- Treating consensus, reputation, token ownership, or agent count as risk authority.
- Treating a README demo, backtest, win rate, P&L screenshot, or funded round-trip as proof of alpha.
- Using markdown, JSONL, in-memory events, or exchange history as the only ledger.
- Combining paper and live credentials in one ambiguous runtime.
- Auto-applying learned strategy/risk changes without versioning, canarying, rollback, and operator visibility.
- Allowing withdrawals, transfers, arbitrary contract calls, or credential changes in the autonomous custody surface.
- Ignoring unknown/reconciliation states after network or venue failure.
- Claiming conclusions about Kompany or Money Agent until their canonical codebases are identified.

## Sources and verification notes

Primary sources inspected:

- [Forage README](https://github.com/capinhoooo/forage)
- [Gordon README](https://github.com/general-liquidity/gordon)
- [Circuit Agent README](https://github.com/Circuit-LLM/circuit-agent)
- [Circuit Cloud README](https://github.com/Circuit-LLM/circuit-agent-cloud)
- [TradingAgents README](https://github.com/TauricResearch/TradingAgents)
- [Agent Boss shared-memory README](https://github.com/markturansky/agent-boss)
- [Agent Boss terminal README](https://github.com/4th-engineer/agent-boss)
- This repository's [Trading System Audit](./TRADING_SYSTEM_AUDIT.md)

The external project descriptions above are architecture findings based on publicly visible repositories as of the date above. “Claims” means the project says it exists; “demonstrated” means the source exposes a concrete path, test, or externally verifiable state. A full source audit of each external repository, live venue verification, and financial due diligence remain separate work.
