import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";
import { getRuntimeSettings } from "@/lib/runtime-settings";
import {
  reasoningAnalysisAgentConfig,
  riskAgentConfig,
} from "../agents/config";
import { parseTradeProposal } from "../agents/trade-proposal";
import { reasoningAnalysisAgent } from "../agents/trading-agents";
import { publishAgentEvent } from "../events/bus";
import {
  type AnalysisProposed,
  type ConsensusReached,
  newId,
  type OrderEvent,
  type RiskDecision,
  type SignalCreated,
} from "../events/contracts";

import { placeOrder } from "../tools/execution-tool";
import { fetchMarketSignals } from "../tools/market-signals-tool";
import { evaluateProposalRiskServer } from "../tools/risk-tool";
import { fetchTechnicals } from "../tools/technical-analysis-tool";

/**
 * Consensus workflow: the central coordination pipeline.
 *
 *   SENTIMENT signal -> ANALYSIS proposals (independent) -> COORDINATOR vote
 *   aggregation -> RISK hard validation -> EXECUTION order
 *
 * Invariants enforced here:
 * - Consensus approval is advisory only.
 * - Risk approval is mandatory; unapproved proposals emit RISK_REJECTED.
 * - Execution is the only component that submits broker orders.
 * - Every state transition is published to the typed event stream.
 */

const CONSENSUS_THRESHOLD = 0.5;

/**
 * Consensus quorum: the operator-configured threshold (runtime settings,
 * PUT /api/settings/runtime) as a 0–1 fraction. An undefined/null stored
 * value falls back to a simple majority. This makes the /settings
 * CONSENSUS QUORUM slider a real, enforced coordination parameter.
 */
async function getConsensusThreshold(): Promise<number> {
  const settings = await getRuntimeSettings();
  return settings.consensusQuorum / 100;
}

const signalSchema = z.object({
  asset: z.string().describe("Asset symbol, e.g. BTC-USD"),
  source: z.string().default("manual"),
});

const signalOutputSchema = z.object({
  signal: z.object({
    asset: z.string(),
    confidence: z.number().min(0).max(1),
    highlights: z.array(z.string()),
    signalId: z.string(),
    source: z.string(),
  }),
});

const signalStep = createStep({
  description: "SENTIMENT: gather the market signal for the asset",
  execute: async ({ inputData, mastra }) => {
    const { asset, source } = inputData;
    const sentiment = await fetchMarketSignals(asset);

    const signal: SignalCreated = {
      asset,
      confidence: Math.max(0, Math.min(1, sentiment.sentimentScore)),
      createdAt: new Date().toISOString(),
      signalId: newId("sig"),
      source,
      type: "SIGNAL_CREATED",
    };

    if (mastra) {
      await publishAgentEvent(mastra, signal);
    }

    return {
      signal: {
        asset,
        confidence: signal.confidence,
        highlights: sentiment.highlights,
        signalId: signal.signalId,
        source,
      },
    };
  },
  id: "signal",
  inputSchema: signalSchema,
  outputSchema: signalOutputSchema,
});

const analysisStep = createStep({
  description: "ANALYSIS: technical snapshot + LLM reasoning proposal",
  execute: async ({ inputData, mastra }) => {
    const { signal } = inputData;
    const { asset } = signal;

    const technicals = await fetchTechnicals(asset);
    const reasoning = await reasoningAnalysisAgent.generate(
      `Market signal for ${asset}: confidence ${signal.confidence}.
Highlights: ${signal.highlights.join("; ")}
Technical context: trend ${technicals.trend}, RSI ${technicals.rsi}, regime ${technicals.regime}, patterns: ${technicals.patterns.join("; ")}.

Decide LONG, SHORT, or ABSTAIN with a confidence 0-1 and a short rationale. Reply as JSON: {"direction":"LONG"|"SHORT"|"ABSTAIN","confidence":number,"reasoning":string}`,
    );

    const parsed = parseTradeProposal(reasoning.text);

    // LLM output is untrusted input: only an explicit LONG/SHORT counts as
    // a direction. ABSTAIN, a missing/unparsable field, or any other value
    // means NO PROPOSAL — the pipeline ends here (no direction is invented
    // from technical context, which would turn a non-decision into a trade).
    if (!parsed) {
      return {
        proposal: null,
      };
    }

    const proposal: AnalysisProposed = {
      agentId: reasoningAnalysisAgentConfig.id,
      asset,
      confidence: parsed.confidence,
      createdAt: new Date().toISOString(),
      direction: parsed.direction,
      proposalId: newId("prp"),
      reasoning: parsed.reasoning,
      signalId: signal.signalId,
      type: "ANALYSIS_PROPOSED",
    };

    if (mastra) {
      await publishAgentEvent(mastra, proposal);
    }

    return {
      proposal: {
        asset,
        confidence: parsed.confidence,
        direction: parsed.direction,
        proposalId: proposal.proposalId,
        reasoning: proposal.reasoning,
        signalId: signal.signalId,
      },
    };
  },
  id: "analysis",
  inputSchema: signalOutputSchema,
  outputSchema: z.object({
    // Null when the reasoning agent abstained or returned unparsable
    // output: downstream steps skip cleanly instead of trading on a
    // fabricated direction.
    proposal: z
      .object({
        asset: z.string(),
        confidence: z.number().min(0).max(1),
        direction: z.enum(["LONG", "SHORT"]),
        proposalId: z.string(),
        reasoning: z.string(),
        signalId: z.string(),
      })
      .nullable(),
  }),
});

const consensusStep = createStep({
  description: "COORDINATION: aggregate votes and form consensus (advisory)",
  execute: async ({ inputData, mastra }) => {
    const { proposal } = inputData;

    // No proposal (LLM abstained or malformed output) — nothing to vote on.
    if (proposal === null) {
      return { consensus: null };
    }

    // Advisory consensus: the coordinator counts analysis votes against the
    // operator-configured quorum. Confidence at or above the quorum counts
    // as a vote for; below is a vote against.
    const threshold = await getConsensusThreshold();
    const votesFor = proposal.confidence >= threshold ? 1 : 0;
    const votesAgainst = votesFor === 1 ? 0 : 1;
    const approved =
      votesFor / (votesFor + votesAgainst) >= CONSENSUS_THRESHOLD;

    const consensus: ConsensusReached = {
      asset: proposal.asset,
      confidence: proposal.confidence,
      createdAt: new Date().toISOString(),
      direction: proposal.direction,
      proposalId: proposal.proposalId,
      signalId: proposal.signalId,
      type: "CONSENSUS_REACHED",
      votesAgainst,
      votesFor,
    };

    if (mastra) {
      await publishAgentEvent(mastra, consensus);
    }

    return {
      consensus: {
        approved,
        asset: proposal.asset,
        confidence: proposal.confidence,
        direction: proposal.direction,
        proposalId: proposal.proposalId,
        signalId: proposal.signalId,
        votesAgainst,
        votesFor,
      },
    };
  },
  id: "consensus",
  inputSchema: z.object({
    proposal: z
      .object({
        asset: z.string(),
        confidence: z.number().min(0).max(1),
        direction: z.enum(["LONG", "SHORT"]),
        proposalId: z.string(),
        reasoning: z.string(),
        signalId: z.string(),
      })
      .nullable(),
  }),
  outputSchema: z.object({
    consensus: z
      .object({
        approved: z.boolean(),
        asset: z.string(),
        confidence: z.number().min(0).max(1),
        direction: z.enum(["LONG", "SHORT"]),
        proposalId: z.string(),
        signalId: z.string(),
        votesAgainst: z.number(),
        votesFor: z.number(),
      })
      .nullable(),
  }),
});

const riskGateStep = createStep({
  description:
    "RISK: mandatory hard validation (the only approval that counts)",
  execute: async ({ inputData, mastra }) => {
    const { consensus } = inputData;

    // No proposal reached consensus — the risk gate is never even consulted.
    if (consensus === null) {
      return { decision: null };
    }

    const limits = riskAgentConfig.riskLimits ?? {
      maxDailyLoss: 3,
      maxPositionPct: 5,
    };

    // Server gate: kill switch + daily-loss ledger checks run inside
    // evaluateProposalRiskServer (fail closed on lookup errors).
    const result = await evaluateProposalRiskServer(
      {
        asset: consensus.asset,
        confidence: consensus.confidence,
      },
      {
        maxDailyLossPct: limits.maxDailyLoss,
        maxPositionPct: limits.maxPositionPct,
      },
    );

    const decision: RiskDecision = {
      asset: consensus.asset,
      createdAt: new Date().toISOString(),
      positionSizePct: result.positionSizePct,
      proposalId: consensus.proposalId,
      reason: result.reason,
      type: result.approved ? "RISK_APPROVED" : "RISK_REJECTED",
    };

    if (mastra) {
      await publishAgentEvent(mastra, decision);
    }

    return {
      decision: {
        approved: result.approved,
        asset: consensus.asset,
        direction: consensus.direction,
        positionSizePct: result.positionSizePct,
        proposalId: consensus.proposalId,
        reason: result.reason,
      },
    };
  },
  id: "risk-gate",
  inputSchema: z.object({
    consensus: z
      .object({
        approved: z.boolean(),
        asset: z.string(),
        confidence: z.number().min(0).max(1),
        direction: z.enum(["LONG", "SHORT"]),
        proposalId: z.string(),
        signalId: z.string(),
        votesAgainst: z.number(),
        votesFor: z.number(),
      })
      .nullable(),
  }),
  outputSchema: z.object({
    decision: z
      .object({
        approved: z.boolean(),
        asset: z.string(),
        direction: z.enum(["LONG", "SHORT"]),
        positionSizePct: z.number(),
        proposalId: z.string(),
        reason: z.string(),
      })
      .nullable(),
  }),
});

const executionStep = createStep({
  description: "EXECUTION: submit the order for risk-approved proposals only",
  execute: async ({ inputData, mastra }) => {
    const { decision } = inputData;

    // Nothing reached the risk gate (abstain/malformed analysis) — no order.
    if (decision === null) {
      return {
        order: {
          asset: "",
          orderId: "",
          status: "BLOCKED" as const,
        },
      };
    }

    // Execution is the only component allowed to submit broker orders, and
    // only when the mandatory risk gate has approved the proposal.
    if (!decision.approved) {
      return {
        order: {
          asset: decision.asset,
          orderId: "",
          status: "BLOCKED" as const,
        },
      };
    }

    const orderResult = await placeOrder({
      asset: decision.asset,
      direction: decision.direction,
      positionSizePct: decision.positionSizePct,
      proposalId: decision.proposalId,
    });

    const order: OrderEvent = {
      asset: decision.asset,
      createdAt: new Date().toISOString(),
      detail: orderResult.detail,
      direction: decision.direction,
      orderId: orderResult.orderId,
      proposalId: decision.proposalId,
      quantity: orderResult.quantity,
      type:
        orderResult.status === "FILLED"
          ? "ORDER_FILLED"
          : orderResult.status === "PENDING"
            ? "ORDER_SUBMITTED"
            : "ORDER_FAILED",
    };

    if (mastra) {
      await publishAgentEvent(mastra, order);
    }

    return {
      order: {
        asset: decision.asset,
        orderId: order.orderId,
        status: orderResult.status,
      },
    };
  },
  id: "execution",
  inputSchema: z.object({
    decision: z
      .object({
        approved: z.boolean(),
        asset: z.string(),
        direction: z.enum(["LONG", "SHORT"]),
        positionSizePct: z.number(),
        proposalId: z.string(),
        reason: z.string(),
      })
      .nullable(),
  }),
  outputSchema: z.object({
    order: z.object({
      asset: z.string(),
      orderId: z.string(),
      status: z.enum(["FILLED", "FAILED", "PENDING", "BLOCKED"]),
    }),
  }),
});

export const consensusWorkflow = createWorkflow({
  description:
    "Signal -> analysis -> consensus -> risk gate -> execution, publishing typed events at every stage",
  id: "consensus-workflow",
  inputSchema: signalSchema,
  outputSchema: z.object({
    order: z.object({
      asset: z.string(),
      orderId: z.string(),
      status: z.enum(["FILLED", "FAILED", "PENDING", "BLOCKED"]),
    }),
  }),
})
  .then(signalStep)
  .then(analysisStep)
  .then(consensusStep)
  .then(riskGateStep)
  .then(executionStep)
  .commit();
