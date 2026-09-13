import type { BrokerAdapter } from "./broker/adapter";
import { createBrokerAdapter } from "./broker/adapter";

export * from "./broker/adapter";
export * from "./okx/auth";
export * from "./okx/client";
export * from "./okx/config";
export * from "./okx/types";
export * from "./okx/websocket";

/**
 * Default broker adapter bound to the configured OKX account. No WebSocket
 * stream is attached; use {@link createBrokerAdapter} with an
 * {@link OKXWebSocketClient} when real-time order/position updates are needed.
 */
export const broker: BrokerAdapter = createBrokerAdapter();
