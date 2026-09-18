import {
  buildDecisionMetadata,
  type DecisionMetadata,
  type DecisionOutcome,
  type DecisionSnapshot,
  persistDecisionSnapshot,
  snapshotInputsForSignal,
  snapshotInputsForTechnicals,
} from "@/ai/audit/decision-snapshot";
import {
  createCapitalIntent,
  createNoTradeDecision,
  hashCapitalIntent,
} from "@/ai/capital-engine/intent";
import {
  CONSENSUS_PLUGIN_FIXTURES,
  CONSENSUS_PLUGIN_MANIFEST,
  CONSENSUS_PLUGIN_SOURCE,
} from "@/ai/capital-engine/plugin-runtime";
import { isStrategyPluginEnabled } from "@/ai/capital-engine/strategy-lifecycle";
import {
  registerStrategyPluginSource,
  runRegisteredStrategyPlugin,
} from "@/ai/capital-engine/strategy-registry";
import { log } from "@/lib/evlog";
import {
  getLatestPromotionRecord,
  registerStrategyPlugin,
} from "@/lib/promotion-records";
import { getRuntimeSettings } from "@/lib/runtime-settings";
import { riskAgentConfig } from "../agents/config";
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
import type { RiskEvaluation } from "../tools/risk-tool";
import { evaluateProposalRiskServer } from "../tools/risk-tool";
import { fetchTechnicals } from "../tools/technical-analysis-tool";

export interface ConsensusWorkflowInput {
  asset: string;
  /**
   * Optional cancellation: aborting cancels the in-flight isolated plugin
   * runs (the workers are terminated immediately) — the workflow surface
   * for shutting down or revoking a pass mid-run.
   */
  signal?: AbortSignal;
  source: string;
}

export interface ConsensusWorkflowResult {
  order: {
    asset: string;
    orderId: string;
    status: "FILLED" | "FAILED" | "PENDING" | "BLOCKED" | "NO_TRADE";
  };
}

/**
 * The correlation basis for one workflow run: the plugin registry is
 * process-local but decision metadata must be stable per run, so the
 * correlation id is derived from the run's inputs (asset + source + time),
 * not from a plugin that may be re-registered.
 */
function proposalIdBasis(input: ConsensusWorkflowInput): string {
  return `wf:${input.asset}:${input.source}`;
}

/**
 * Stages where the workflow must run the full pipeline but suppress the
 * broker submission (checklist §7 — shadow mode with zero orders). Only
 * SHADOW today; a predicate so future observation-only stages reuse the
 * same evidence path.
 */
export function isShadowSuppressedStage(stage: string | undefined): boolean {
  return stage === "SHADOW";
}

/**
 * The persisted outcome for a shadow-suppressed run: the REAL risk
 * evaluation is preserved verbatim (approved flag, size, kernel reason) so
 * the SHADOW→PAPER evidence shows what the system would have done, with an
 * explicit suppression prefix — a shadow record must never be mistaken for
 * a block the risk kernel itself issued.
 */
export function buildShadowDecisionOutcome(
  risk: RiskEvaluation,
): DecisionOutcome {
  return {
    blocked: true,
    order: null,
    risk: {
      approved: risk.approved,
      positionSizePct: risk.positionSizePct,
      reason: `SHADOW MODE — order suppressed (would have ${
        risk.approved
          ? `executed ${risk.positionSizePct}% of book`
          : "been refused"
      }): ${risk.reason}`,
    },
  };
}

export async function runConsensusWorkflow(
  input: ConsensusWorkflowInput,
): Promise<ConsensusWorkflowResult> {
  // Pre-run check: a disabled plugin halts the pipeline BEFORE any spend.
  // Fail-safe: an unknown/missing row reads as disabled. This is the
  // enforcement point for strategy disable/rollback (strategy-lifecycle.ts).
  if (!(await isStrategyPluginEnabled(CONSENSUS_PLUGIN_MANIFEST.pluginId))) {
    return {
      order: {
        asset: input.asset,
        orderId: "",
        status: "BLOCKED",
      },
    };
  }

  const sentiment = await fetchMarketSignals(input.asset);
  const signal: SignalCreated = {
    asset: input.asset,
    confidence: Math.max(0, Math.min(1, sentiment.sentimentScore)),
    createdAt: new Date().toISOString(),
    signalId: newId("sig"),
    source: input.source,
    type: "SIGNAL_CREATED",
  };
  await publishAgentEvent(signal);

  const technicals = await fetchTechnicals(input.asset);
  const reasoning = await reasoningAnalysisAgent.generate(
    `Market signal for ${input.asset}: confidence ${signal.confidence}.\nHighlights: ${sentiment.highlights.join("; ")}\nTechnical context: trend ${technicals.trend}, RSI ${technicals.rsi}, regime ${technicals.regime}, patterns: ${technicals.patterns.join("; ")}.\n\nDecide LONG, SHORT, or ABSTAIN with confidence 0-1. Reply only as JSON: {"direction":"LONG"|"SHORT"|"ABSTAIN","confidence":number,"reasoning":string}`,
  );
  const parsed = parseTradeProposal(reasoning.text);
  if (!parsed) {
    return { order: { asset: "", orderId: "", status: "BLOCKED" } };
  }

  // Decision metadata: WHICH plugin decided (identity from the registry
  // manifest), WHICH model/provider actually produced the reasoning, and
  // WHICH operator settings were in force. Built once per run and stamped
  // onto every persist site (NO_TRADE, quorum block, risk block, order).
  const metadata: DecisionMetadata = await buildDecisionMetadata({
    correlationId: proposalIdBasis(input),
    dataTimestamps: [sentiment.fetchedAt, technicals.fetchedAt],
    modelInfo: {
      modelId: reasoning.resolvedModelId,
      provider: reasoning.provider,
    },
    plugin: {
      configHash: CONSENSUS_PLUGIN_MANIFEST.configHash,
      id: CONSENSUS_PLUGIN_MANIFEST.pluginId,
      version: CONSENSUS_PLUGIN_MANIFEST.pluginVersion,
    },
  });

  const proposal: AnalysisProposed = {
    agentId: "reasoning-analysis-agent",
    asset: input.asset,
    confidence: parsed.confidence,
    createdAt: new Date().toISOString(),
    direction: parsed.direction,
    proposalId: newId("prp"),
    reasoning: parsed.reasoning,
    signalId: signal.signalId,
    type: "ANALYSIS_PROPOSED",
  };
  await publishAgentEvent(proposal);

  // The workflow supplies plugin IDENTITY, never source: the registry
  // resolves the immutable source bound to (pluginId, configHash) and runs
  // it through the isolated worker realm. Registration replays the plugin's
  // deterministic fixtures through the runtime before the row is persisted.
  // Persisting the manifest row via the DB-backed registerStrategyPlugin
  // keeps promotion-lineage parity.
  await registerStrategyPluginSource({
    fixtures: CONSENSUS_PLUGIN_FIXTURES,
    manifest: CONSENSUS_PLUGIN_MANIFEST,
    onFirstRegister: (manifest) => registerStrategyPlugin(manifest),
    source: CONSENSUS_PLUGIN_SOURCE,
  });

  const decisionInputs = {
    consensus: {
      confidence: proposal.confidence,
      direction: proposal.direction,
      quorum: 0,
      votesAgainst: 0,
      votesFor: 0,
    },
    proposal: {
      agentId: proposal.agentId,
      asset: proposal.asset,
      confidence: proposal.confidence,
      direction: proposal.direction,
      proposalId: proposal.proposalId,
      reasoning: proposal.reasoning,
      signalId: proposal.signalId,
    },
    signal: snapshotInputsForSignal(signal, sentiment),
    technicals: snapshotInputsForTechnicals(technicals),
  };

  if (proposal.direction === "ABSTAIN") {
    const noTrade = createNoTradeDecision({
      asset: proposal.asset,
      confidence: proposal.confidence,
      proposalId: proposal.proposalId,
      reason: proposal.reasoning,
      signalId: signal.signalId,
      signalFetchedAt: sentiment.fetchedAt,
      technicalsFetchedAt: technicals.fetchedAt,
    });
    const isolatedNoTrade = await runRegisteredStrategyPlugin({
      evidence: {
        asset: proposal.asset,
        signalFetchedAt: sentiment.fetchedAt,
        signalId: signal.signalId,
        technicalsFetchedAt: technicals.fetchedAt,
      },
      input: { candidate: noTrade },
      manifest: CONSENSUS_PLUGIN_MANIFEST,
      signal: input.signal,
    });
    await persistDecisionSnapshot({
      asset: proposal.asset,
      inputs: decisionInputs,
      intentHash: hashCapitalIntent(isolatedNoTrade),
      metadata,
      outcome: {
        blocked: true,
        order: null,
        risk: {
          approved: false,
          positionSizePct: 0,
          reason: "NO_TRADE: strategy explicitly abstained",
        },
      },
      proposalId: proposal.proposalId,
      signalId: signal.signalId,
    });
    return {
      order: { asset: proposal.asset, orderId: "", status: "NO_TRADE" },
    };
  }

  const threshold = (await getRuntimeSettings()).consensusQuorum / 100;
  const votesFor = proposal.confidence >= threshold ? 1 : 0;
  const votesAgainst = votesFor === 1 ? 0 : 1;
  const intent = createCapitalIntent({
    asset: proposal.asset,
    confidence: proposal.confidence,
    direction: proposal.direction,
    proposalId: proposal.proposalId,
    reasoning: proposal.reasoning,
    signalId: signal.signalId,
    signalFetchedAt: sentiment.fetchedAt,
    technicalsFetchedAt: technicals.fetchedAt,
  });
  const isolatedIntent = await runRegisteredStrategyPlugin({
    evidence: {
      asset: proposal.asset,
      signalFetchedAt: sentiment.fetchedAt,
      signalId: signal.signalId,
      technicalsFetchedAt: technicals.fetchedAt,
    },
    input: { candidate: intent },
    manifest: CONSENSUS_PLUGIN_MANIFEST,
    signal: input.signal,
  });
  const intentHash = hashCapitalIntent(isolatedIntent);

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
  await publishAgentEvent(consensus);
  if (votesFor === 0) {
    await persistDecisionSnapshot({
      asset: proposal.asset,
      inputs: {
        ...decisionInputs,
        consensus: {
          ...decisionInputs.consensus,
          quorum: threshold * 100,
          votesAgainst,
          votesFor,
        },
      },
      intentHash,
      metadata,
      outcome: {
        blocked: true,
        order: null,
        risk: {
          approved: false,
          positionSizePct: 0,
          reason: `Consensus confidence below quorum (${threshold * 100}%)`,
        },
      },
      proposalId: proposal.proposalId,
      signalId: signal.signalId,
    });
    return { order: { asset: proposal.asset, orderId: "", status: "BLOCKED" } };
  }

  const limits = riskAgentConfig.riskLimits ?? {
    maxDailyLoss: 3,
    maxPositionPct: 5,
  };
  // The proposing plugin's lineage-head stage drives the canary controls
  // (checklist §7): the risk gate caps (or refuses) canary orders by the
  // predeclared allocation, the rollback monitor budgets canary losses.
  const headRecord = await getLatestPromotionRecord(
    CONSENSUS_PLUGIN_MANIFEST.pluginId,
  );
  const risk = await evaluateProposalRiskServer(
    {
      asset: proposal.asset,
      confidence: proposal.confidence,
      headStage: headRecord?.stage,
    },
    {
      maxDailyLossPct: limits.maxDailyLoss,
      maxPositionPct: limits.maxPositionPct,
    },
  );
  const decision: RiskDecision = {
    asset: proposal.asset,
    createdAt: new Date().toISOString(),
    positionSizePct: risk.positionSizePct,
    proposalId: proposal.proposalId,
    reason: risk.reason,
    type: risk.approved ? "RISK_APPROVED" : "RISK_REJECTED",
  };
  await publishAgentEvent(decision);
  if (!risk.approved) {
    await persistDecisionSnapshot({
      asset: proposal.asset,
      inputs: {
        consensus: {
          confidence: consensus.confidence,
          direction: consensus.direction,
          quorum: threshold * 100,
          votesAgainst: consensus.votesAgainst,
          votesFor: consensus.votesFor,
        },
        proposal: {
          agentId: proposal.agentId,
          asset: proposal.asset,
          confidence: proposal.confidence,
          direction: proposal.direction,
          proposalId: proposal.proposalId,
          reasoning: proposal.reasoning,
          signalId: proposal.signalId,
        },
        signal: snapshotInputsForSignal(signal, sentiment),
        technicals: snapshotInputsForTechnicals(technicals),
      },
      intentHash,
      metadata,
      outcome: {
        blocked: true,
        order: null,
        risk: {
          approved: risk.approved,
          positionSizePct: risk.positionSizePct,
          reason: risk.reason,
        },
      },
      proposalId: proposal.proposalId,
      signalId: signal.signalId,
    });
    return { order: { asset: proposal.asset, orderId: "", status: "BLOCKED" } };
  }

  // Shadow mode (checklist §7): a plugin whose lineage head is at SHADOW
  // runs the FULL pipeline on live data — real signal, isolated plugin
  // execution, capital intent, and the real risk verdict above — but never
  // reaches the broker. The suppressed outcome is persisted as the
  // SHADOW→PAPER promotion evidence: what the plugin WOULD have done, with
  // zero orders existing for the run.
  if (isShadowSuppressedStage(headRecord?.stage)) {
    await persistDecisionSnapshot({
      asset: proposal.asset,
      inputs: {
        ...decisionInputs,
        consensus: {
          ...decisionInputs.consensus,
          quorum: threshold * 100,
          votesAgainst,
          votesFor,
        },
      },
      intentHash,
      metadata,
      outcome: buildShadowDecisionOutcome(risk),
      proposalId: proposal.proposalId,
      signalId: signal.signalId,
    });
    log.info({
      audit: "shadow_order_suppressed",
      headStage: headRecord?.stage,
      pluginId: CONSENSUS_PLUGIN_MANIFEST.pluginId,
      riskApproved: risk.approved,
    });
    return { order: { asset: proposal.asset, orderId: "", status: "BLOCKED" } };
  }

  const result = await placeOrder({
    asset: proposal.asset,
    direction: proposal.direction,
    positionSizePct: risk.positionSizePct,
    proposalId: proposal.proposalId,
    intent: isolatedIntent as typeof intent,
    intentHash,
  });
  const order: OrderEvent = {
    asset: proposal.asset,
    createdAt: new Date().toISOString(),
    detail: result.detail,
    direction: proposal.direction,
    orderId: result.orderId,
    proposalId: proposal.proposalId,
    quantity: result.quantity,
    type:
      result.status === "FILLED"
        ? "ORDER_FILLED"
        : result.status === "PENDING"
          ? "ORDER_SUBMITTED"
          : "ORDER_FAILED",
  };
  await publishAgentEvent(order);

  const snapshot: DecisionSnapshot = {
    asset: proposal.asset,
    inputs: {
      consensus: {
        confidence: consensus.confidence,
        direction: consensus.direction,
        quorum: threshold * 100,
        votesAgainst: consensus.votesAgainst,
        votesFor: consensus.votesFor,
      },
      proposal: {
        agentId: proposal.agentId,
        asset: proposal.asset,
        confidence: proposal.confidence,
        direction: proposal.direction,
        proposalId: proposal.proposalId,
        reasoning: proposal.reasoning,
        signalId: proposal.signalId,
      },
      signal: snapshotInputsForSignal(signal, sentiment),
      technicals: snapshotInputsForTechnicals(technicals),
    },
    outcome: {
      order: {
        asset: proposal.asset,
        detail: result.detail,
        direction: proposal.direction,
        orderId: result.orderId,
        quantity: result.quantity,
        status: result.status,
      },
      risk: {
        approved: risk.approved,
        positionSizePct: risk.positionSizePct,
        reason: risk.reason,
      },
    },
    intentHash,
    metadata,
    proposalId: proposal.proposalId,
    signalId: signal.signalId,
  };
  await persistDecisionSnapshot(snapshot);

  return {
    order: {
      asset: proposal.asset,
      orderId: order.orderId,
      status: result.status,
    },
  };
}
