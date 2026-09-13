import { z } from "zod";

/**
 * Typed event contracts for the agent swarm trading system.
 *
 * Agents never call each other directly. They communicate exclusively by
 * publishing these events to the Mastra PubSub bus and subscribing to the
 * topics they care about. This keeps every team (SENTIMENT, ANALYSIS, RISK,
 * EXECUTION, COORDINATION) decoupled and independently replaceable.
 */

export const SignalCreatedSchema = z.object({
  asset: z.string(),
  confidence: z.number().min(0).max(1),
  createdAt: z.string(),
  signalId: z.string(),
  source: z.string(),
  type: z.literal("SIGNAL_CREATED"),
});

export const AnalysisProposedSchema = z.object({
  agentId: z.string(),
  asset: z.string(),
  confidence: z.number().min(0).max(1),
  createdAt: z.string(),
  direction: z.enum(["LONG", "SHORT"]),
  proposalId: z.string(),
  reasoning: z.string(),
  signalId: z.string(),
  type: z.literal("ANALYSIS_PROPOSED"),
});

export const RiskDecisionSchema = z.object({
  asset: z.string(),
  createdAt: z.string(),
  positionSizePct: z.number().min(0).max(100).optional(),
  proposalId: z.string(),
  reason: z.string(),
  type: z.enum(["RISK_APPROVED", "RISK_REJECTED"]),
});

export const OrderEventSchema = z.object({
  asset: z.string(),
  createdAt: z.string(),
  detail: z.string().optional(),
  direction: z.enum(["LONG", "SHORT"]),
  orderId: z.string(),
  proposalId: z.string(),
  quantity: z.number(),
  type: z.enum(["ORDER_SUBMITTED", "ORDER_FILLED", "ORDER_FAILED"]),
});

export const ConsensusReachedSchema = z.object({
  asset: z.string(),
  confidence: z.number().min(0).max(1),
  createdAt: z.string(),
  direction: z.enum(["LONG", "SHORT"]),
  proposalId: z.string(),
  signalId: z.string(),
  type: z.literal("CONSENSUS_REACHED"),
  votesAgainst: z.number(),
  votesFor: z.number(),
});

export const AgentEventSchema = z.discriminatedUnion("type", [
  SignalCreatedSchema,
  AnalysisProposedSchema,
  RiskDecisionSchema,
  OrderEventSchema,
  ConsensusReachedSchema,
]);

export type SignalCreated = z.infer<typeof SignalCreatedSchema>;
export type AnalysisProposed = z.infer<typeof AnalysisProposedSchema>;
export type RiskDecision = z.infer<typeof RiskDecisionSchema>;
export type OrderEvent = z.infer<typeof OrderEventSchema>;
export type ConsensusReached = z.infer<typeof ConsensusReachedSchema>;
export type AgentEvent = z.infer<typeof AgentEventSchema>;

export type AgentEventType = AgentEvent["type"];

/**
 * Single canonical topic for the trading event stream. All agent events flow
 * through it; subscribers filter by `event.type`. A single topic keeps the
 * fan-out simple for the realtime UI / audit log consumers.
 */
export const TRADING_EVENT_TOPIC = "trading.events.v1";

/**
 * Deterministic ids for event payloads. Exported so workflow steps and tools
 * generate ids in exactly one shape.
 */
export function newId(prefix: string): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}${random}`;
}
