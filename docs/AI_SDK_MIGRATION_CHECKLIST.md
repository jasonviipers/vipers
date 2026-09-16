# AI SDK Migration Checklist

## Dependency and configuration cleanup

- [x] Add the core `ai` package using Bun.
- [x] Confirm the former agent-framework packages are removed from `package.json` and `bun.lock`.
- [x] Remove framework-specific Next.js external-package configuration.
- [x] Remove the former framework database URL from environment validation.
- [x] Remove the former framework API route and Postgres-backed storage wiring.

## Runtime migration

- [x] Rename the former agent module to `src/ai`.
- [x] Replace framework agents with AI SDK `generateText`-backed `TradingAgent` wrappers.
- [x] Replace framework tool definitions with AI SDK `tool` definitions.
- [x] Replace the workflow graph with the typed `runConsensusWorkflow` orchestration function.
- [x] Replace framework PubSub with a process-wide typed event bus.
- [x] Preserve event validation, runtime status, recent-event buffering, and audit listeners.
- [x] Preserve the deterministic risk gate and execution-only broker boundary.
- [x] Update API routes and scheduled jobs to use the new `src/ai` modules.

## Documentation and reference cleanup

- [x] Update README architecture and dependency documentation.
- [x] Update trading-system audit references.
- [x] Update internal audit skill references.
- [x] Confirm repository search contains no former framework references.

## Verification

- [x] TypeScript check: `bunx tsc --noEmit`.
- [x] Focused AI/trading tests: 28 passing.
- [ ] Existing `src/lib/broker-health.test.ts` remains blocked by its pre-existing `server-only` Bun test-environment import error.
- [ ] Full project lint remains blocked by existing unrelated formatting/lint findings outside this migration; migrated files pass focused Biome formatting.
- [ ] Run the production build in an environment with the project’s required runtime environment variables configured.
