import { authHeaders, generateClOrdId } from "./auth";
import { createOKXConfig } from "./config";
import type {
  AccountBalance,
  GetOrderParams,
  MaxAvailSize,
  OKXResponse,
  OrderDetail,
  OrderRequest,
  OrderResponse,
  Position,
  Ticker,
} from "./types";

/**
 * OKX v5 REST API client.
 *
 * Wraps authenticated and public endpoints the broker adapter needs:
 * placing orders, fetching order state, account balances and positions.
 * Every private call signs the request via `authHeaders`.
 */

export class OKXClient {
  private buildUrl(path: string): string {
    return `${createOKXConfig().restBaseUrl}${path}`;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    query: Record<string, string> = {},
  ): Promise<OKXResponse<T>> {
    const requestBody = body ? JSON.stringify(body) : "";
    const requestPath = appendQuery(path, query);
    const response = await fetch(this.buildUrl(requestPath), {
      body: requestBody || undefined,
      headers: authHeaders(method, requestPath, requestBody),
      method,
    });
    const json = (await response.json()) as OKXResponse<T>;
    if (json.code !== "0") {
      throw new Error(`OKX ${path} failed: code ${json.code} — ${json.msg}`);
    }
    return json;
  }

  /**
   * Place an order. Returns the OKX order payload; caller must reconcile
   * the `sCode`/`sMsg` fields since a rejected order still returns HTTP 200.
   */
  async placeOrder(request: OrderRequest): Promise<OrderResponse> {
    const body = {
      clOrdId: request.clOrdId ?? generateClOrdId(),
      instId: request.instId,
      ordType: request.ordType,
      px: request.px,
      side: request.side,
      sz: request.sz,
      tdMode: request.tdMode,
    };
    const res = await this.request<OrderResponse>(
      "POST",
      "/api/v5/trade/order",
      body,
    );
    const [order] = res.data;
    if (!order) {
      throw new Error(`OKX order placement returned no data: ${res.msg}`);
    }
    return order;
  }

  async getOrder(params: GetOrderParams): Promise<OrderDetail> {
    const query: Record<string, string> = { instId: params.instId };
    if (params.ordId) {
      query.ordId = params.ordId;
    }
    if (params.clOrdId) {
      query.clOrdId = params.clOrdId;
    }
    const res = await this.request<OrderDetail>(
      "GET",
      "/api/v5/trade/order",
      undefined,
      query,
    );
    const [order] = res.data;
    if (!order) {
      throw new Error("OKX order lookup returned no data");
    }
    return order;
  }

  async getBalance(): Promise<AccountBalance | undefined> {
    const res = await this.request<AccountBalance>(
      "GET",
      "/api/v5/account/balance",
    );
    return res.data[0];
  }

  /**
   * Maximum order size the account can trade for an instrument. `availBuy`
   * (quote currency for spot) and `availSell` (base currency for spot) are
   * the honest caps — the exchange already factors in frozen balances,
   * outstanding orders and spot-mode rules.
   */
  async getMaxAvailSize(instId: string, tdMode: string): Promise<MaxAvailSize> {
    const res = await this.request<MaxAvailSize>(
      "GET",
      "/api/v5/account/max-avail-size",
      undefined,
      { instId, tdMode },
    );
    const [entry] = res.data;
    if (!entry) {
      throw new Error("OKX max-avail-size lookup returned no data");
    }
    return entry;
  }

  async getPositions(instType?: string): Promise<Position[]> {
    const res = await this.request<Position>(
      "GET",
      "/api/v5/account/positions",
      undefined,
      instType ? { instType } : {},
    );
    return res.data;
  }

  async getInstruments(instType = "SPOT"): Promise<
    {
      baseCcy: string;
      instId: string;
      lotSz: string;
      minSz: string;
      tickSz: string;
    }[]
  > {
    const res = await this.request<{
      baseCcy: string;
      instId: string;
      lotSz: string;
      minSz: string;
      tickSz: string;
    }>("GET", "/api/v5/public/instruments", undefined, { instType });
    return res.data;
  }

  async getTicker(instId: string): Promise<Ticker | undefined> {
    const res = await this.request<Ticker>(
      "GET",
      "/api/v5/market/ticker",
      undefined,
      { instId },
    );
    return res.data[0];
  }
}

function appendQuery(path: string, query: Record<string, string>): string {
  if (Object.keys(query).length === 0) {
    return path;
  }
  const params = new URLSearchParams(query).toString();
  return `${path}?${params}`;
}

export const okxClient = new OKXClient();
