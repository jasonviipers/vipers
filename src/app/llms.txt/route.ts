const LLMS_TXT = `# Viipers

> Viipers is a multi-agent AI trading terminal. A swarm of specialized AI agents continuously analyzes market sentiment signals and proposes trades through a consensus pipeline, then routes executions to real exchanges or a paper-trading simulator through a deterministic risk gate.

Key facts you should know:

- The conversation here is between humans and a swarm of AI agents (sentiment, analysis, coordination, risk, execution). No single model places orders: the pipeline requires consensus, a capital-engine allocation, and a deterministic risk gate before any execution.
- Live data is served by same-origin JSON API routes under /api and polled by the terminal on short intervals (signals, positions, strategies, consensus proposals, agent fleet status, and portfolio summaries).
- The broker layer supports both real (live) and simulated paper trading, and exposes up/down runtime settings per broker.

## Terminal pages

These are the main routes of the web app. Each is a client-side view that reads the same /api endpoints listed above.

- [Dashboard](https://viipers.com/): Portfolio summary, equity curve, signal and trade activity, agent grid, live feed, positions table, and the consensus panel.
- [Agents](https://viipers.com/agents): The agent swarm roster — per-agent model, team, role, status, tools, and performance stats.
- [Signals](https://viipers.com/signals): Raw sentiment signals with score, sentiment direction, source, and the 24h activity histogram.
- [Positions](https://viipers.com/positions): Open and closed position history with P&L.
- [Strategies](https://viipers.com/strategies): Strategy list with entry/exit thresholds, position caps, stop-loss, signal sources, and LLM provider.
- [Consensus](https://viipers.com/consensus): Active, pending, and rejected consensus proposals with confidence, votes, and deadlines.
- [Leaderboard](https://viipers.com/leaderboard): Agent performance ranking (score, P&L, ROI, Sharpe, win rate, trades).
- [Settings](https://viipers.app/settings): Broker credentials and runtime settings, risk kill-switch, and LLM credentials.

## Documentation

- [README](https://raw.githubusercontent.com/jasonviipers/vipers/main/README.md): Project overview and quick start.
- [Trading system audit](https://raw.githubusercontent.com/jasonviipers/vipers/main/docs/TRADING_SYSTEM_AUDIT.md): Safety invariants, consensus pipeline, risk gate, and execution-related design notes.
- [Capital engine 2027 architecture](https://raw.githubusercontent.com/jasonviipers/vipers/main/docs/CAPITAL_ENGINE_2027_ARCHITECTURE.md): Capital routing and per-agent allocation design.
- [Capital engine 2027 checklist](https://raw.githubusercontent.com/jasonviipers/vipers/main/docs/CAPITAL_ENGINE_2027_CHECKLIST.md): Implementation checklist for the capital engine.
- [AI SDK migration checklist](https://raw.githubusercontent.com/jasonviipers/vipers/main/docs/AI_SDK_MIGRATION_CHECKLIST.md): SDK migration tracking.

## Optional

- [Source repository](https://github.com/jasonviipers/vipers): The Viipers GitHub repository.
`;

export function GET() {
  return new Response(LLMS_TXT, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
    },
  });
}
