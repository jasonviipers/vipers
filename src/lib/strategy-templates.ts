import type { SignalSource, StrategyType } from "@/lib/queries/strategies";

/**
 * Named strategy blueprints for the STRATEGY MANAGER.
 *
 * A template is a "battle-tested" starting point: every field the strategy
 * form needs except identity. The LLM provider is intentionally NOT part of
 * a template — provider is an operator environment decision resolved from
 * AGENT CONFIGURATION → DEFAULT LLM PROVIDER at form-open time, never baked
 * into a blueprint. `name` is the display name, seeded into the form so the
 * user clones-and-edits instead of starting from a blank line.
 */
export interface StrategyTemplate {
  /** Stable slug used as a React key and for template lookups. */
  id: string;
  /** Display name; seeds the form's Strategy Name field. */
  name: string;
  shortDescription: string;
  type: StrategyType;
  assets: string[];
  signalSources: SignalSource[];
  entryThreshold: number;
  exitThreshold: number;
  maxPositionPct: number;
  stopLossPct: number;
}

export const STRATEGY_TEMPLATES: StrategyTemplate[] = [
  {
    id: "btc-trend-follower",
    name: "BTC Trend Follower",
    shortDescription: "Ride established BTC-family momentum with tight exits",
    type: "MOMENTUM",
    assets: ["BTC", "ETH", "SOL"],
    signalSources: ["reddit", "twitter"],
    entryThreshold: 75,
    exitThreshold: 40,
    maxPositionPct: 20,
    stopLossPct: 6,
  },
  {
    id: "us-tech-momentum",
    name: "US Tech Momentum",
    shortDescription: "Megacap tech names driven by RSS news flow",
    type: "MOMENTUM",
    assets: ["NVDA", "AAPL", "TSLA", "AMZN", "GOOGL"],
    signalSources: ["rss", "twitter"],
    entryThreshold: 72,
    exitThreshold: 45,
    maxPositionPct: 15,
    stopLossPct: 5,
  },
  {
    id: "altcoin-sentiment-swing",
    name: "Altcoin Sentiment Swing",
    shortDescription: "Social-fueled swings on high-beta alts, no directions",
    type: "SENTIMENT_ONLY",
    assets: ["SOL", "XRP", "DOGE"],
    signalSources: ["twitter", "reddit"],
    entryThreshold: 70,
    exitThreshold: 35,
    maxPositionPct: 10,
    stopLossPct: 8,
  },
  {
    id: "mean-reversion-cluster",
    name: "Mean-Reversion Cluster",
    shortDescription:
      "Buy the dip on correlated majors after RSS-driven drawdowns",
    type: "MEAN_REVERSION",
    assets: ["BTC", "ETH", "NVDA", "TSLA"],
    signalSources: ["rss"],
    entryThreshold: 55,
    exitThreshold: 78,
    maxPositionPct: 25,
    stopLossPct: 4,
  },
];

/** Lookup helper for tests / future server-side seeding. */
function _getStrategyTemplate(id: string): StrategyTemplate | undefined {
  return STRATEGY_TEMPLATES.find((t) => t.id === id);
}
