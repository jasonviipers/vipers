import type { AgentEvent } from "@/ai/events/contracts";
import { agentRuntime } from "@/ai/runtime/agent-runtime";
import { useLogger, withEvlog } from "@/lib/evlog";
import { getRuntimeSettings } from "@/lib/runtime-settings";

export const dynamic = "force-dynamic";

interface FeedEventDto {
  id: string;
  category: "consensus" | "trade" | "signal" | "alert" | "heartbeat";
  asset: string | null;
  message: string;
  timestamp: string;
}

function toCategory(type: AgentEvent["type"]): FeedEventDto["category"] {
  switch (type) {
    case "SIGNAL_CREATED":
    case "ANALYSIS_PROPOSED":
      return "signal";
    case "CONSENSUS_REACHED":
      // Its own category so the /settings consensusAlerts toggle controls
      // it directly instead of piggybacking on heartbeat (agent status).
      return "consensus";
    case "RISK_APPROVED":
      return "heartbeat";
    case "RISK_REJECTED":
    case "ORDER_FAILED":
      return "alert";
    case "ORDER_SUBMITTED":
    case "ORDER_FILLED":
      return "trade";
  }
}

function toMessage(event: AgentEvent): string {
  switch (event.type) {
    case "SIGNAL_CREATED":
      return `sentiment signal (${event.source})`;
    case "ANALYSIS_PROPOSED":
      return `${event.direction.toLowerCase()} proposal @ ${(event.confidence * 100).toFixed(0)}% conf — ${event.reasoning}`;
    case "CONSENSUS_REACHED":
      return `consensus ${event.direction.toLowerCase()} (${event.votesFor}-${event.votesAgainst})`;
    case "RISK_APPROVED":
      return `risk approved (${event.positionSizePct ?? 0}% size) — ${event.reason}`;
    case "RISK_REJECTED":
      return `risk rejected — ${event.reason}`;
    case "ORDER_SUBMITTED":
      return `order submitted ${event.direction.toLowerCase()} ${event.quantity}`;
    case "ORDER_FILLED":
      return `filled ${event.direction.toLowerCase()} ${event.quantity}`;
    case "ORDER_FAILED":
      return `order failed ${event.direction.toLowerCase()} ${event.quantity}${event.detail ? ` — ${event.detail}` : ""}`;
  }
}

/**
 * Raw pipeline detail appended to messages in DEBUG MODE: vote counts,
 * position sizing, order/proposal ids — the internals an operator needs
 * when auditing what the swarm actually decided.
 */
function toDebugSuffix(event: AgentEvent): string {
  switch (event.type) {
    case "SIGNAL_CREATED":
      return ` [src=${event.source} conf=${event.confidence.toFixed(2)}]`;
    case "ANALYSIS_PROPOSED":
      return ` [proposal=${event.proposalId} dir=${event.direction}]`;
    case "CONSENSUS_REACHED":
      return ` [votes=${event.votesFor}/${event.votesFor + event.votesAgainst} dir=${event.direction}]`;
    case "RISK_APPROVED":
      return ` [size=${event.positionSizePct ?? 0}%]`;
    case "RISK_REJECTED":
      return ` [reason=${event.reason}]`;
    case "ORDER_SUBMITTED":
    case "ORDER_FILLED":
    case "ORDER_FAILED":
      return ` [order=${event.orderId} qty=${event.quantity}]`;
  }
}

/** Stable-enough key for React list rendering + client dedupe. */
function toId(event: AgentEvent): string {
  switch (event.type) {
    case "SIGNAL_CREATED":
      return event.signalId;
    case "ANALYSIS_PROPOSED":
      return event.proposalId;
    case "CONSENSUS_REACHED":
      return `${event.proposalId}-cons`;
    case "RISK_APPROVED":
    case "RISK_REJECTED":
      return `${event.proposalId}-risk`;
    case "ORDER_SUBMITTED":
    case "ORDER_FILLED":
    case "ORDER_FAILED":
      return `${event.orderId}-${event.type}`;
  }
}

/**
 * GET /api/events/recent — newest-first slice of the process-local
 * recent-events ring buffer, shaped for the dashboard's LiveFeed. Mirrors
 * the events fallback used by the signals/trades activity routes.
 *
 * DEBUG MODE (operator setting, PUT /api/settings/runtime): when enabled,
 * the heartbeat category is replaced with a "debug" category and raw
 * pipeline detail (vote counts, position sizing, order ids) is appended to
 * messages, so operators can inspect what the swarm actually decided.
 */
export const GET = withEvlog(async () => {
  const logger = useLogger();
  logger.set({ integration: "events" });

  const settings = await getRuntimeSettings();
  const raw = agentRuntime.listRecentEvents(50);

  const items: FeedEventDto[] = raw
    .map((event) => ({
      asset: "asset" in event ? event.asset : null,
      category: toCategory(event.type),
      id: toId(event),
      message:
        settings.debugMode === true
          ? `${toMessage(event)}${toDebugSuffix(event)}`
          : toMessage(event),
      timestamp: event.createdAt,
    }))
    .reverse();

  // Same "recent heartbeat means online" rule as /api/agents/db, scaled
  // by the operator's heartbeat-interval setting.
  const onlineWindowMs =
    Math.min(Math.max(settings.heartbeatInterval * 3, 30), 600) * 1000;
  const onlineCount = agentRuntime
    .listStatuses()
    .filter(
      (status) =>
        status.lastHeartbeatAt !== null &&
        Date.now() - new Date(status.lastHeartbeatAt).getTime() <
          onlineWindowMs,
    ).length;

  return Response.json({
    items,
    onlineCount,
    total: raw.length,
  });
});
