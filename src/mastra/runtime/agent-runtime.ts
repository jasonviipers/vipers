import {
  type AgentRuntimeStatus,
  createEmptyRuntimeStatus,
} from "../agents/config";
import {
  type AgentEvent,
  AgentEventSchema,
  TRADING_EVENT_TOPIC,
} from "../events/contracts";

/**
 * Agent runtime: subscribes agents to the typed event stream, records
 * heartbeats and metrics separately from configuration, keeps a bounded
 * recent-events buffer, and fans events out to audit-log listeners.
 *
 * Config (what an agent is) lives in `agents/config.ts`. This module owns
 * status (how an agent is doing) while the system runs.
 */

interface MinimalPubSub {
  publish: (
    topic: string,
    event: { type: string; data: unknown; runId: string },
  ) => Promise<void>;
  subscribe: (
    topic: string,
    callback: (event: {
      type: string;
      data?: unknown;
      runId?: string;
    }) => void | Promise<void>,
    options?: { group?: string },
  ) => Promise<void>;
}

type AuditListener = (event: AgentEvent) => void;

const RECENT_EVENTS_LIMIT = 200;

/**
 * Event types produced by a specific team. Used to attribute events without
 * an explicit `agentId` (e.g. emitted directly by workflow steps) to the
 * agent whose role produced them, so heartbeats and metrics stay meaningful.
 */
const EVENT_TYPE_TO_AGENT_ID: Record<AgentEvent["type"], string> = {
  ANALYSIS_PROPOSED: "reasoning-analysis-agent",
  CONSENSUS_REACHED: "orchestrator-agent",
  ORDER_FAILED: "order-executor-agent",
  ORDER_FILLED: "order-executor-agent",
  ORDER_SUBMITTED: "order-executor-agent",
  RISK_APPROVED: "risk-agent",
  RISK_REJECTED: "risk-agent",
  SIGNAL_CREATED: "sentiment-agent",
};

function resolveAgentIdForEvent(event: AgentEvent): string {
  if ("agentId" in event && event.agentId) {
    return event.agentId;
  }
  return EVENT_TYPE_TO_AGENT_ID[event.type];
}

export class AgentRuntime {
  private readonly statuses = new Map<string, AgentRuntimeStatus>();
  private readonly auditListeners = new Set<AuditListener>();
  private readonly recentEvents: AgentEvent[] = [];
  private pubsub: MinimalPubSub | null = null;

  /**
   * Attach the process-wide event bus. Must be called before `start()` so
   * the runtime listens on the SAME bus instance the Mastra workflows
   * publish to (mastra.pubsub), not a private one.
   */
  attachPubSub(pubsub: MinimalPubSub): void {
    this.pubsub = pubsub;
  }

  registerAgent(id: string): void {
    if (!this.statuses.has(id)) {
      this.statuses.set(id, createEmptyRuntimeStatus(id));
    }
  }

  heartbeat(id: string): void {
    this.registerAgent(id);
    const status = this.statuses.get(id);
    if (status) {
      status.lastHeartbeatAt = new Date().toISOString();
      status.health = "HEALTHY";
    }
  }

  recordHandled(id: string, handleTimeMs: number): void {
    const status = this.statuses.get(id);
    if (!status) {
      return;
    }
    status.metrics.eventsHandled += 1;
    const total = status.metrics.eventsHandled;
    const prev = status.metrics.avgHandleTimeMs ?? handleTimeMs;
    status.metrics.avgHandleTimeMs = Number(
      ((prev * (total - 1) + handleTimeMs) / total).toFixed(2),
    );
  }

  recordError(id: string): void {
    const status = this.statuses.get(id);
    if (!status) {
      return;
    }
    status.metrics.errors += 1;
    if (status.metrics.errors > 5) {
      status.health = "DEGRADED";
    }
  }

  getStatus(id: string): AgentRuntimeStatus | undefined {
    return this.statuses.get(id);
  }

  listStatuses(): AgentRuntimeStatus[] {
    return [...this.statuses.values()];
  }

  /**
   * Newest-last copy of the recent event ring buffer (bounded).
   */
  listRecentEvents(limit: number): AgentEvent[] {
    const count = Math.min(Math.max(limit, 0), this.recentEvents.length);
    return this.recentEvents.slice(-count);
  }

  onAuditEvent(listener: AuditListener): () => void {
    this.auditListeners.add(listener);
    return () => {
      this.auditListeners.delete(listener);
    };
  }

  private recordEvent(event: AgentEvent): void {
    this.recentEvents.push(event);
    if (this.recentEvents.length > RECENT_EVENTS_LIMIT) {
      this.recentEvents.splice(
        0,
        this.recentEvents.length - RECENT_EVENTS_LIMIT,
      );
    }

    const agentId = resolveAgentIdForEvent(event);
    if (this.statuses.has(agentId)) {
      this.heartbeat(agentId);
      this.recordHandled(agentId, 0);
    }
  }

  /**
   * Subscribe the runtime to the trading event topic on the attached bus.
   * Every event is validated, buffered for the recent-events API, attributed
   * to its producing agent, and fanned out to audit listeners (realtime UI /
   * audit log consumers).
   */
  async start(): Promise<void> {
    if (!this.pubsub) {
      throw new Error(
        "AgentRuntime.start() called before attachPubSub(); the runtime must share the Mastra pubsub instance",
      );
    }
    await this.pubsub.subscribe(TRADING_EVENT_TOPIC, (raw) => {
      const parsed = AgentEventSchema.safeParse(raw.data);
      if (!parsed.success) {
        return;
      }
      this.recordEvent(parsed.data);
      for (const listener of this.auditListeners) {
        try {
          listener(parsed.data);
        } catch {
          // A broken listener must never break the event loop.
        }
      }
    });
  }

  async publish(event: AgentEvent): Promise<void> {
    if (!this.pubsub) {
      throw new Error("AgentRuntime.publish() called before attachPubSub()");
    }
    await this.pubsub.publish(TRADING_EVENT_TOPIC, {
      data: event,
      runId: `${event.type}:${new Date().toISOString()}`,
      type: event.type,
    });
  }
}

export const agentRuntime = new AgentRuntime();
