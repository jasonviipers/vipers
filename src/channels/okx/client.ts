import { z } from "zod";
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
 * Every private call signs the request via `authHeaders`, which resolves
 * credentials from the server-side store (DB) on each call.
 */

/**
 * OKX API error carrying the exchange's numeric code. Callers (health
 * checks, credential diagnostics) match on the code to distinguish auth
 * failures (50113 invalid sign, 50119 unknown key, 50111/50112 credential
 * problems) from transient issues and to give the operator a targeted fix.
 */
const okxEnvelopeSchema = z.object({
  code: z.string(),
  data: z.array(z.unknown()),
  msg: z.string(),
});

export class OKXApiError extends Error {
  readonly code: string;
  readonly path: string;

  constructor(code: string, msg: string, path: string) {
    super(`OKX ${path} failed: code ${code} — ${msg}`);
    this.name = "OKXApiError";
    this.code = code;
    this.path = path;
  }
}

export class OKXClient {
  private async buildUrl(path: string): Promise<string> {
    const config = await createOKXConfig();
    return `${config.restBaseUrl}${path}`;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    query: Record<string, string> = {},
  ): Promise<OKXResponse<T>> {
    const requestBody = body ? JSON.stringify(body) : "";
    const requestPath = appendQuery(path, query);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    let response: Response;
    try {
      response = await fetch(await this.buildUrl(requestPath), {
        body: requestBody || undefined,
        headers: await authHeaders(method, requestPath, requestBody),
        method,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      throw new OKXApiError(
        String(response.status),
        `HTTP ${response.status} ${response.statusText}`,
        path,
      );
    }

    const parsed = okxEnvelopeSchema.safeParse(await response.json());
    if (!parsed.success) {
      throw new Error(`OKX ${path} returned an invalid response envelope`);
    }
    const json = parsed.data as OKXResponse<T>;
    if (json.code !== "0") {
      throw new OKXApiError(json.code, json.msg, path);
    }
    return json;
  }

  /**
   * Place an order. Returns the OKX order payload; caller must reconcile
   * the `sCode`/`sMsg` fields since a rejected order still returns HTTP 200.
   */
  async placeOrder(request: OrderRequest): Promise<OrderResponse> {
    const body = {
      clOrdId: request.clOrdId ?? (await generateClOrdIdAsync()),
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

/**
 * Sync generateClOrdId is kept for non-order uses; the client awaits this
 * async alias so a future DB-derived component stays possible without
 * touching call sites again.
 */
async function generateClOrdIdAsync(): Promise<string> {
  return generateClOrdId();
}

function appendQuery(path: string, query: Record<string, string>): string {
  if (Object.keys(query).length === 0) {
    return path;
  }
  const params = new URLSearchParams(query).toString();
  return `${path}?${params}`;
}

export const okxClient = new OKXClient();
