import {
  type AgentEvent,
  AgentEventSchema,
  TRADING_EVENT_TOPIC,
} from "./contracts";

/**
 * Thin typed wrapper over the Mastra PubSub bus.
 *
 * Workflow steps and agents use `publishAgentEvent` / `subscribeToAgentEvents`
 * instead of touching the raw PubSub contract, so the event envelope
 * (topic, type, data) stays in one place.
 */

export type AgentEventPublisher = (event: AgentEvent) => Promise<void>;

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

export interface MinimalMastra {
  pubsub: MinimalPubSub;
}

export async function publishAgentEvent(
  mastra: MinimalMastra,
  event: AgentEvent,
): Promise<void> {
  await mastra.pubsub.publish(TRADING_EVENT_TOPIC, {
    data: event,
    runId: `${event.type}:${new Date().toISOString()}`,
    type: event.type,
  });
}

export async function subscribeToAgentEvents(
  mastra: MinimalMastra,
  handler: (event: AgentEvent) => void | Promise<void>,
  options?: { group?: string },
): Promise<void> {
  await mastra.pubsub.subscribe(
    TRADING_EVENT_TOPIC,
    (raw) => {
      const parsed = AgentEventSchema.safeParse(raw.data);
      if (parsed.success) {
        return handler(parsed.data);
      }
    },
    options,
  );
}
