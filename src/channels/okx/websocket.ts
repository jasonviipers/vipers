import { WebSocket } from "ws";

import { timestampMs, wsSign } from "./auth";
import { createOKXConfig } from "./config";
import type {
  OKXConfig,
  WSOrderMessage,
  WSPositionMessage,
  WSTicker,
  WSTickerMessage,
} from "./types";

/**
 * OKX v5 WebSocket client.
 *
 * Private channels (orders, account, positions) and public channels
 * (tickers) connect to the private endpoint and require a login handshake
 * before subscribing. The client handles ping/pong keepalive and
 * automatically re-publishes channels after an unexpected reconnect.
 *
 * Inbound messages follow two shapes:
 * - Control: `{"event":"login", "code":"0", "msg":""}` (login/subscribe/pong)
 * - Data:    `{"arg":{...}, "data":[...]}` (ticker/order/position updates)
 */

interface WSInboundControl {
  code?: string;
  event?: string;
  msg?: string;
}

interface Callbacks {
  onDisconnect?: (code: number, reason: string) => void;
  onError?: (error: Error) => void;
  onOrder?: (data: WSOrderMessage["data"]) => void;
  onPosition?: (data: WSPositionMessage["data"]) => void;
  onTicker?: (data: WSTicker[]) => void;
}

type Channel = "account" | "orders" | "positions" | `tickers-${string}`;

interface ChannelArg {
  channel: string;
  instId?: string;
  instType?: string;
}

type WSState = "authenticated" | "closed" | "connecting" | "disconnected";

export class OKXWebSocketClient {
  private readonly callbacks: Callbacks;
  private readonly channels = new Set<Channel>();
  private socket?: WebSocket;
  private pingTimer?: NodeJS.Timeout;
  private reconnectTimer?: NodeJS.Timeout;
  private state: WSState = "disconnected";

  constructor(callbacks: Callbacks = {}) {
    this.callbacks = callbacks;
  }

  private config(): OKXConfig {
    return createOKXConfig();
  }

  connect(): void {
    if (this.state === "closed") {
      return;
    }
    this.openSocket(this.config().wsBaseUrl);
  }

  private openSocket(baseUrl: string): void {
    this.state = "connecting";
    const privatePath = `${baseUrl}/private${
      this.config().simulated ? "?brokerId=9999" : ""
    }`;
    this.socket = new WebSocket(privatePath);
    this.socket.on("open", () => this.login());
    this.socket.on("message", (data) => this.onMessage(String(data)));
    this.socket.on("close", (code, reason) =>
      this.onClose(code, reason.toString()),
    );
    this.socket.on("error", (error) => {
      this.callbacks.onError?.(new Error(error.message));
    });
  }

  private onMessage(raw: string): void {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      this.callbacks.onError?.(new Error(`OKX WS non-JSON message: ${raw}`));
      return;
    }

    if ("event" in parsed) {
      this.handleControl(parsed as WSInboundControl);
      return;
    }
    if ("arg" in parsed && "data" in parsed) {
      this.handleData(parsed);
    }
  }

  private handleControl(control: WSInboundControl): void {
    switch (control.event) {
      case "login": {
        if (control.code === "0" || control.msg === "") {
          this.onLoginSuccess();
        } else {
          this.callbacks.onError?.(
            new Error(`OKX WS login failed: ${control.msg ?? "unknown"}`),
          );
        }
        break;
      }
      case "subscribe": {
        if (control.code && control.code !== "0" && control.msg) {
          this.callbacks.onError?.(
            new Error(`OKX WS subscribe failed: ${control.msg}`),
          );
        }
        break;
      }
      case "pong": {
        break;
      }
      default: {
        break;
      }
    }
  }

  private handleData(parsed: Record<string, unknown>): void {
    const arg = parsed.arg as { channel?: string } | undefined;
    if (arg?.channel === "tickers") {
      this.callbacks.onTicker?.((parsed.data as WSTickerMessage["data"]) ?? []);
    } else if (arg?.channel === "orders") {
      this.callbacks.onOrder?.((parsed.data as WSOrderMessage["data"]) ?? []);
    } else if (arg?.channel === "positions") {
      this.callbacks.onPosition?.(
        (parsed.data as WSPositionMessage["data"]) ?? [],
      );
    }
  }

  private onLoginSuccess(): void {
    this.state = "authenticated";
    this.subscribeAll();
    this.startPing();
  }

  private login(): void {
    const config = this.config();
    this.send({
      args: [
        {
          apiKey: config.apiKey,
          passphrase: config.passphrase,
          sign: wsSign(timestampMs()),
          timestamp: timestampMs(),
        },
      ],
      op: "login",
    });
  }

  private subscribeAll(): void {
    this.subscribe(
      [...this.channels].flatMap((channel): ChannelArg[] => {
        if (channel === "account") {
          return [{ channel }];
        }
        if (channel === "orders") {
          return [{ channel: "orders", instType: "ANY" }];
        }
        if (channel === "positions") {
          return [{ channel: "positions", instType: "ANY" }];
        }
        const instId = channel.replace("tickers-", "");
        return [{ channel: "tickers", instId }];
      }),
    );
  }

  subscribeToOrders(): void {
    this.channels.add("orders");
    this.subscribe([{ channel: "orders", instType: "ANY" }]);
  }

  subscribeToAccount(): void {
    this.channels.add("account");
    this.subscribe([{ channel: "account" }]);
  }

  subscribeToPositions(): void {
    this.channels.add("positions");
    this.subscribe([{ channel: "positions", instType: "ANY" }]);
  }

  subscribeToTicker(instId: string): void {
    const channel = `tickers-${instId}` as Channel;
    this.channels.add(channel);
    this.subscribe([{ channel: "tickers", instId }]);
  }

  private subscribe(args: ChannelArg[]): void {
    if (this.state !== "authenticated") {
      return;
    }
    this.send({
      args,
      op: "subscribe",
    });
  }

  private send(message: unknown): void {
    if (this.socket?.readyState !== WebSocket.OPEN) {
      return;
    }
    this.socket.send(JSON.stringify(message));
  }

  private startPing(): void {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      this.send({ op: "ping" });
    }, 20_000);
  }

  private stopPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = undefined;
    }
  }

  private onClose(code: number, reason: string): void {
    const wasClosedByUser = this.state === "closed";
    this.state = "disconnected";
    this.stopPing();
    this.callbacks.onDisconnect?.(code, reason);
    if (wasClosedByUser) {
      return;
    }
    this.reconnectTimer = setTimeout(() => this.connect(), 1000);
  }

  close(): void {
    this.state = "closed";
    this.stopPing();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    this.socket?.close();
  }
}
