import { type AgentEvent, AgentEventSchema } from "./contracts";

export type AgentEventPublisher = (event: AgentEvent) => Promise<void>;
type AgentEventHandler = (event: AgentEvent) => void | Promise<void>;

const GLOBAL_BUS_KEY = "__viipersTradingEventBus__";

class TradingEventBus {
  private readonly handlers = new Set<AgentEventHandler>();

  async publish(event: AgentEvent): Promise<void> {
    const parsed = AgentEventSchema.parse(event);
    await Promise.allSettled(
      [...this.handlers].map((handler) => Promise.resolve(handler(parsed))),
    );
  }

  subscribe(handler: AgentEventHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }
}

function getGlobalBus(): TradingEventBus {
  const globalStore = globalThis as typeof globalThis & {
    [GLOBAL_BUS_KEY]?: TradingEventBus;
  };
  if (!globalStore[GLOBAL_BUS_KEY]) {
    globalStore[GLOBAL_BUS_KEY] = new TradingEventBus();
  }
  return globalStore[GLOBAL_BUS_KEY];
}

export const tradingEventBus = getGlobalBus();

export function publishAgentEvent(event: AgentEvent): Promise<void> {
  return tradingEventBus.publish(event);
}

export function subscribeToAgentEvents(handler: AgentEventHandler): () => void {
  return tradingEventBus.subscribe(handler);
}
