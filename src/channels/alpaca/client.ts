import { authHeadersFor } from "./auth";
import { createAlpacaConfig } from "./config";
import type {
  AlpacaAccount,
  AlpacaBar,
  AlpacaCryptoLatestBarsResponse,
  AlpacaEquityLatestBarResponse,
  AlpacaErrorPayload,
  AlpacaHistoricalBarsResponse,
  AlpacaOrder,
  AlpacaOrderRequest,
  AlpacaPosition,
} from "./types";

/**
 * Alpaca Markets trading + market data REST client.
 *
 * Wraps the authenticated endpoints the broker adapter needs: placing
 * market orders, fetching order state for reconciliation, account equity
 * (balance sync + health probe) and current positions (SHORT sizing).
 * Every call resolves the current credentials from the server-side store,
 * so paper/live routing follows the ACTIVE credential slot automatically.
 */

const REQUEST_TIMEOUT_MS = 10_000;

/** Alpaca operational/HTTP error carrying the API's message + HTTP status. */
export class AlpacaApiError extends Error {
  readonly httpStatus: number;
  readonly path: string;

  constructor(message: string, httpStatus: number, path: string) {
    super(`Alpaca ${path} failed: ${message}`);
    this.name = "AlpacaApiError";
    this.httpStatus = httpStatus;
    this.path = path;
  }
}

async function parseErrorPayload(
  response: Response,
): Promise<AlpacaErrorPayload | null> {
  const text = await response.text().catch(() => "");
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text) as AlpacaErrorPayload;
  } catch {
    return { message: text.slice(0, 300) };
  }
}

class AlpacaClient {
  private async request<T>(
    method: string,
    path: string,
    options: {
      baseUrl?: "data" | "rest";
      body?: unknown;
      query?: Record<string, string>;
    } = {},
  ): Promise<T> {
    const config = await createAlpacaConfig();
    const requestPath = appendQuery(path, options.query ?? {});
    const base =
      options.baseUrl === "data" ? config.dataBaseUrl : config.restBaseUrl;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(`${base}${requestPath}`, {
        body: options.body ? JSON.stringify(options.body) : undefined,
        headers: authHeadersFor(config),
        method,
        signal: controller.signal,
      });
    } catch (error) {
      throw new Error(
        `Alpaca request to ${path} failed: ${
          error instanceof Error ? error.message : "network error"
        }`,
      );
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const payload = await parseErrorPayload(response);
      throw new AlpacaApiError(
        payload?.message ?? `HTTP ${response.status} ${response.statusText}`,
        response.status,
        path,
      );
    }

    const text = await response.text();
    if (!text) {
      return undefined as T;
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new Error(`Alpaca ${path} returned an invalid JSON payload`);
    }
  }

  /** Current account snapshot (equity / buying power / currency). */
  async getAccount(): Promise<AlpacaAccount> {
    return this.request<AlpacaAccount>("GET", "/v2/account");
  }

  /** Place a market order; callers reconcile `status` to a terminal state. */
  async placeOrder(request: AlpacaOrderRequest): Promise<AlpacaOrder> {
    return this.request<AlpacaOrder>("POST", "/v2/orders", {
      body: request,
    });
  }

  /** Look up one order by exchange order id. */
  async getOrder(orderId: string): Promise<AlpacaOrder> {
    return this.request<AlpacaOrder>(
      "GET",
      `/v2/orders/${encodeURIComponent(orderId)}`,
    );
  }

  /** Look up an order by its client order id (proposal-derived, deterministic). */
  async getOrderByClientOrderId(clientOrderId: string): Promise<AlpacaOrder> {
    const orders = await this.request<AlpacaOrder[]>("GET", "/v2/orders", {
      query: {
        client_order_id: clientOrderId,
        limit: "1",
        status: "all",
      },
    });
    const order = orders[0];
    if (!order) {
      throw new Error(
        `Alpaca order lookup returned no order for client_order_id=${clientOrderId}`,
      );
    }
    return order;
  }

  /**
   * Non-throwing variant for existence probes (paper-venue verification):
   * null means the venue answered and no order carries the id — which
   * still proves the authenticated order-query contract round-trips.
   * HTTP/auth/transport failures still throw.
   */
  async findOrderByClientOrderId(
    clientOrderId: string,
  ): Promise<AlpacaOrder | null> {
    const orders = await this.request<AlpacaOrder[]>("GET", "/v2/orders", {
      query: {
        client_order_id: clientOrderId,
        limit: "1",
        status: "all",
      },
    });
    return orders[0] ?? null;
  }

  /** All current positions (optionally one symbol, e.g. "BTC/USD"). */
  async getPositions(symbol?: string): Promise<AlpacaPosition[]> {
    if (symbol) {
      const position = await this.request<AlpacaPosition>(
        "GET",
        `/v2/positions/${encodeURIComponent(symbol)}`,
      );
      return [position];
    }
    return this.request<AlpacaPosition[]>("GET", "/v2/positions");
  }

  /**
   * Historical bars for a symbol over [start, end] (epoch ms), following
   * pagination to exhaustion. Equities use the stocks v2 bars endpoint;
   * crypto (slash-prefixed symbols) use the v1beta3 crypto bars endpoint —
   * the same split as getLatestPrice. Bars come back ascending by time.
   * Feeds the point-in-time backtest dataset (src/lib/jobs/pit-ingestion-job.ts).
   */
  async getHistoricalBars(
    symbol: string,
    startMs: number,
    endMs: number,
    timeframe = "1Hour",
  ): Promise<AlpacaBar[]> {
    const all: AlpacaBar[] = [];
    let pageToken: string | undefined;
    const isCrypto = symbol.includes("/");
    do {
      const query: Record<string, string> = {
        end: new Date(endMs).toISOString(),
        start: new Date(startMs).toISOString(),
        timeframe,
      };
      if (pageToken) {
        query.page_token = pageToken;
      }
      const res = isCrypto
        ? await this.request<AlpacaHistoricalBarsResponse>(
            "GET",
            `/v1beta3/crypto/${encodeURIComponent(symbol)}/bars`,
            { baseUrl: "data", query },
          )
        : await this.request<AlpacaHistoricalBarsResponse>(
            "GET",
            `/v2/stocks/${encodeURIComponent(symbol)}/bars`,
            { baseUrl: "data", query: { ...query, feed: "sip" } },
          );
      if (res.bars) {
        all.push(...res.bars);
      }
      pageToken = res.next_page_token ?? undefined;
    } while (pageToken);
    return all;
  }

  /**
   * Latest price for a symbol. Equities use the stocks latest-bar endpoint;
   * crypto (slash-prefixed symbols) use the v1beta3 crypto latest bars.
   * Fails closed (throws) when the feed has no bar — never fabricates a price.
   */
  async getLatestPrice(symbol: string): Promise<number> {
    if (symbol.includes("/")) {
      const res = await this.request<AlpacaCryptoLatestBarsResponse>(
        "GET",
        "/v1beta3/crypto/latest/bars",
        {
          baseUrl: "data",
          query: { symbols: symbol },
        },
      );
      const bar = res.bars?.[symbol] as AlpacaBar | undefined;
      if (!bar) {
        throw new Error(`No market data bar for ${symbol}`);
      }
      const price = Number(bar.c);
      if (!(price > 0) || !Number.isFinite(price)) {
        throw new Error(`Unreadable market data price for ${symbol}`);
      }
      return price;
    }

    const res = await this.request<AlpacaEquityLatestBarResponse>(
      "GET",
      `/v2/stocks/${encodeURIComponent(symbol)}/bars/latest`,
      {
        baseUrl: "data",
        query: { feed: "sip" },
      },
    );
    if (!res.bar) {
      throw new Error(`No market data bar for ${symbol}`);
    }
    const price = Number(res.bar.c);
    if (!(price > 0) || !Number.isFinite(price)) {
      throw new Error(`Unreadable market data price for ${symbol}`);
    }
    return price;
  }
}

function appendQuery(path: string, query: Record<string, string>): string {
  const entries = Object.entries(query);
  if (entries.length === 0) {
    return path;
  }
  const params = new URLSearchParams(entries).toString();
  return `${path}?${params}`;
}

export const alpacaClient = new AlpacaClient();
