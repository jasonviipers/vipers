import { parseTradeProposal } from "@/ai/agents/trade-proposal";
import { reasoningAnalysisAgent } from "@/ai/agents/trading-agents";
import {
  type AnalysisProposed,
  newId,
  type SignalCreated,
} from "@/ai/events/contracts";
import { agentRuntime } from "@/ai/runtime/agent-runtime";
import { fetchMarketSignals } from "@/ai/tools/market-signals-tool";
import { fetchTechnicals } from "@/ai/tools/technical-analysis-tool";
import { getLogger, withEvlog } from "@/lib/evlog";
import { requirePermission } from "@/lib/session-auth";

export const dynamic = "force-dynamic";

const RUNNABLE_ASSETS = [
  "BTC",
  "ETH",
  "SOL",
  "XRP",
  "DOGE",
  "AAPL",
  "NVDA",
  "TSLA",
];

interface RunResponse {
  proposals: Array<{
    agentId: string;
    agentName: string;
    asset: string;
    confidence: number;
    direction: "LONG" | "SHORT";
    entryPrice: number | null;
    proposalId: string;
    quantity: number;
    reasoning: string;
  }>;
}

/**
 * POST /api/agents/db/[id]/run — trigger an agent run ("RUN AI ANALYSIS").
 *
 * Runs the same first two stages the consensus workflow runs (SENTIMENT
 * signal → ANALYSIS reasoning proposal) but stops before consensus/risk/
 * execution so results surface as *paper trade proposals* requiring manual
 * approval in the UI. Every stage publishes its typed event on the shared
 * bus, so heartbeats/metrics stay consistent with real workflow runs.
 *
 * The proposal payload intentionally mirrors the consensus workflow's
 * analysis step, including its heuristic fallback when the LLM returns
 * unparsable output.
 */
export const POST = withEvlog(
  async (request: Request, ctx: { params: Promise<{ id: string }> }) => {
    const logger = getLogger();
    logger.set({ integration: "agents" });

    // Spends an LLM call — write-capable identity only (demo is read-only).
    const auth = requirePermission(request, "run:agent");
    if (!auth.ok) {
      return auth.response;
    }
    logger.set({
      caller: { subject: auth.identity.subject, kind: auth.identity.kind },
    });

    const { id } = await ctx.params;
    if (id !== reasoningAnalysisAgentConfigId) {
      return Response.json(
        { error: "only the reasoning-analysis-agent can run analysis" },
        { status: 404 },
      );
    }

    // A self-service agent API key may only trigger its own agent run — an
    // operator session may trigger any runnable agent.
    if (
      auth.identity.kind === "agent" &&
      auth.identity.agentId !== reasoningAnalysisAgentConfigId
    ) {
      return Response.json(
        { error: "an agent key may only run its own agent" },
        { status: 403 },
      );
    }

    let asset: string | undefined;
    try {
      const body = (await request.json()) as { asset?: string };
      asset = body?.asset;
    } catch {
      // no/invalid body — fall through to default asset
    }
    const target = asset?.toUpperCase() ?? "BTC";
    if (!RUNNABLE_ASSETS.includes(target)) {
      return Response.json(
        { error: `unsupported asset: ${target}` },
        { status: 400 },
      );
    }

    // Stage 1 — SENTIMENT (identical to the workflow's signal step).
    const sentiment = await fetchMarketSignals(target);
    const signal: SignalCreated = {
      asset: target,
      confidence: Math.max(0, Math.min(1, sentiment.sentimentScore)),
      createdAt: new Date().toISOString(),
      signalId: newId("sig"),
      source: "manual-run",
      type: "SIGNAL_CREATED",
    };
    await agentRuntime.publish(signal);

    // Stage 2 — ANALYSIS (identical to the workflow's analysis step).
    const technicals = await fetchTechnicals(target);
    const proposals: RunResponse["proposals"] = [];

    try {
      const reasoning = await reasoningAnalysisAgent.generate(
        `Market signal for ${target}: confidence ${signal.confidence}.
Highlights: ${sentiment.highlights.join("; ")}
Technical context: trend ${technicals.trend}, RSI ${technicals.rsi}, regime ${technicals.regime}, patterns: ${technicals.patterns.join("; ")}.

Decide LONG, SHORT, or ABSTAIN with a confidence 0-1 and a short rationale. Reply as JSON: {"direction":"LONG"|"SHORT"|"ABSTAIN","confidence":number,"reasoning":string}`,
      );

      const parsed = parseTradeProposal(reasoning.text);

      // LLM output is untrusted: only an explicit LONG/SHORT counts for
      // this analysis-only endpoint. The full workflow persists ABSTAIN as
      // NO_TRADE; this endpoint has no durable evidence bundle yet.
      if (!parsed || parsed.direction === "ABSTAIN") {
        logger.set({
          warning: parsed
            ? "reasoning agent returned an explicit abstention"
            : "reasoning agent returned unparsable output",
        });
        return Response.json({ proposals: [] } satisfies RunResponse);
      }

      const proposal: AnalysisProposed = {
        agentId: "reasoning-analysis-agent",
        asset: target,
        confidence: parsed.confidence,
        createdAt: new Date().toISOString(),
        direction: parsed.direction,
        proposalId: newId("prp"),
        reasoning: parsed.reasoning,
        signalId: signal.signalId,
        type: "ANALYSIS_PROPOSED",
      };
      await agentRuntime.publish(proposal);

      proposals.push({
        agentId: proposal.agentId,
        agentName: "Reasoning Analysis Agent",
        asset: target,
        confidence: parsed.confidence,
        direction: parsed.direction,
        entryPrice: null,
        proposalId: proposal.proposalId,
        quantity: 0,
        reasoning: proposal.reasoning,
      });
    } catch (error) {
      logger.set({
        warning: `analysis run failed: ${
          error instanceof Error ? error.message : "unknown"
        }`,
      });
      return Response.json(
        { error: "analysis run failed; see server logs" },
        { status: 502 },
      );
    }

    return Response.json({ proposals } satisfies RunResponse);
  },
);

// Keep the agent id in sync with the config without importing the whole
// config module twice; the string matches reasoningAnalysisAgentConfig.id.
const reasoningAnalysisAgentConfigId = "reasoning-analysis-agent";
