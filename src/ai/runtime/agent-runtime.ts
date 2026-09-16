import {
  type AgentRuntimeStatus,
  agentConfigs,
  createEmptyRuntimeStatus,
} from "../agents/config";
import { subscribeToAgentEvents } from "../events/bus";
import { type AgentEvent, AgentEventSchema } from "../events/contracts";

interface RuntimeState {
  statuses: Map<string, AgentRuntimeStatus>;
  recentEvents: AgentEvent[];
  started: boolean;
}

type AuditListener = (event: AgentEvent) => void;
const RECENT_EVENTS_LIMIT = 200;
const GLOBAL_RUNTIME_KEY = "__viipersAgentRuntime__";
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
  return "agentId" in event && event.agentId
    ? event.agentId
    : EVENT_TYPE_TO_AGENT_ID[event.type];
}

class AgentRuntime {
  private readonly state: RuntimeState = {
    recentEvents: [],
    started: false,
    statuses: new Map(),
  };
  private readonly auditListeners = new Set<AuditListener>();

  registerAgent(id: string): void {
    if (!this.state.statuses.has(id)) {
      this.state.statuses.set(id, createEmptyRuntimeStatus(id));
    }
  }

  heartbeat(id: string): void {
    this.registerAgent(id);
    const status = this.state.statuses.get(id);
    if (status) {
      status.lastHeartbeatAt = new Date().toISOString();
      status.health = "HEALTHY";
    }
  }

  getStatus(id: string): AgentRuntimeStatus | undefined {
    return this.state.statuses.get(id);
  }

  listStatuses(): AgentRuntimeStatus[] {
    return [...this.state.statuses.values()];
  }

  listRecentEvents(limit: number): AgentEvent[] {
    const count = Math.min(Math.max(limit, 0), this.state.recentEvents.length);
    return this.state.recentEvents.slice(-count);
  }

  onAuditEvent(listener: AuditListener): () => void {
    this.auditListeners.add(listener);
    return () => this.auditListeners.delete(listener);
  }

  private recordEvent(event: AgentEvent): void {
    this.state.recentEvents.push(event);
    if (this.state.recentEvents.length > RECENT_EVENTS_LIMIT) {
      this.state.recentEvents.splice(
        0,
        this.state.recentEvents.length - RECENT_EVENTS_LIMIT,
      );
    }
    const agentId = resolveAgentIdForEvent(event);
    if (this.state.statuses.has(agentId)) {
      this.heartbeat(agentId);
      const status = this.state.statuses.get(agentId);
      if (status) {
        status.metrics.eventsHandled += 1;
        const count = status.metrics.eventsHandled;
        const previous = status.metrics.avgHandleTimeMs ?? 0;
        status.metrics.avgHandleTimeMs = Number(
          ((previous * (count - 1)) / count).toFixed(2),
        );
      }
    }
    for (const listener of this.auditListeners) {
      try {
        listener(event);
      } catch {
        // Audit listeners are isolated from the event bus.
      }
    }
  }

  start(): void {
    if (this.state.started) {
      return;
    }
    this.state.started = true;
    subscribeToAgentEvents((raw) => {
      const parsed = AgentEventSchema.safeParse(raw);
      if (parsed.success) {
        this.recordEvent(parsed.data);
      }
    });
  }

  publish(event: AgentEvent): Promise<void> {
    return import("../events/bus").then(({ publishAgentEvent }) =>
      publishAgentEvent(event),
    );
  }
}

function getGlobalAgentRuntime(): AgentRuntime {
  const globalStore = globalThis as typeof globalThis & {
    [GLOBAL_RUNTIME_KEY]?: AgentRuntime;
  };
  if (!globalStore[GLOBAL_RUNTIME_KEY]) {
    globalStore[GLOBAL_RUNTIME_KEY] = new AgentRuntime();
  }
  return globalStore[GLOBAL_RUNTIME_KEY];
}

export const agentRuntime = getGlobalAgentRuntime();
for (const agent of agentConfigs) {
  agentRuntime.registerAgent(agent.id);
}
agentRuntime.start();
