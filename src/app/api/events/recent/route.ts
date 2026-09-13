import { useLogger, withEvlog } from "@/lib/evlog";
import type { AgentEvent } from "@/mastra/events/contracts";
import { agentRuntime } from "@/mastra/runtime/agent-runtime";

export const dynamic = "force-dynamic";

interface FeedEventDto {
  id: string;
  category: "trade" | "signal" | "alert" | "heartbeat";
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
 */
export const GET = withEvlog(async () => {
  const logger = useLogger();
  logger.set({ integration: "events" });

  const raw = agentRuntime.listRecentEvents(50);

  const items: FeedEventDto[] = raw
    .map((event) => ({
      asset: "asset" in event ? event.asset : null,
      category: toCategory(event.type),
      id: toId(event),
      message: toMessage(event),
      timestamp: event.createdAt,
    }))
    .reverse();

  // Same "recent heartbeat means online" rule as /api/agents/db.
  const onlineCount = agentRuntime
    .listStatuses()
    .filter(
      (status) =>
        status.lastHeartbeatAt !== null &&
        Date.now() - new Date(status.lastHeartbeatAt).getTime() < 90_000,
    ).length;

  return Response.json({
    items,
    onlineCount,
    total: raw.length,
  });
});
