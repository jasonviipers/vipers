/**
 * StockTwits Whisperer API client (https://stocktwitsapi.com).
 *
 * All endpoints require the `x-api-key` header. Messages carry optional AI
 * sentiment scores (`sentiment_bullish` / `sentiment_bearish` /
 * `sentiment_neutral`, 0..1 floats; null until analyzed). Requests time out
 * and retry with exponential backoff on 429 (free tier is 5 req/min, so
 * consumers should cache aggressively).
 */

const BASE_URL = "https://api.stocktwitsapi.com/v1";

export interface StockTwitsMessage {
  id: number;
  internal_id: string;
  body: string;
  created_at: string;
  user: {
    id: number;
    username: string;
    name: string | null;
    avatar_url: string | null;
    join_date?: string;
  };
  symbols: Array<{
    symbol: string;
    symbol_display?: string;
    exchange?: string;
    region?: string;
  }>;
  sentiment_bullish?: number | null;
  sentiment_bearish?: number | null;
  sentiment_neutral?: number | null;
}

export interface StockTwitsMessagesResponse {
  messages: StockTwitsMessage[];
  total: number;
  has_more: boolean;
  page_size: number;
  next_cursor?: { created_at: string; id: string };
  next_offset?: number;
  symbol?: {
    symbol: string;
    watchlist_count: number;
    total_messages: number;
    last_scraped_at: string;
  };
}

export interface StockTwitsTrendingSymbol {
  symbol: string;
  watchlist_count: number;
  trending_score: number;
}

export interface StockTwitsTrendingResponse {
  symbols: StockTwitsTrendingSymbol[];
  cached: boolean;
  fetched_at: string;
}

export interface StockTwitsSymbolInfo {
  symbol: string;
  symbol_display: string;
  total_messages: number;
  first_scraped_at: string;
  last_scraped_at: string;
}

export interface MessageFilters {
  symbol: string;
  start?: string;
  end?: string;
  limit?: number;
  keyword?: string;
  username?: string;
  primaryOnly?: boolean;
  order?: "asc" | "desc";
  signal?: AbortSignal;
}

export class APIError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(`[${status}] ${message}`);
    this.name = "APIError";
  }
}

export class StockTwitsAPI {
  private apiKey: string;
  private maxRetries = 2;

  constructor({ apiKey }: { apiKey: string }) {
    if (!apiKey.trim()) {
      throw new APIError(401, "StockTwits API key is empty", "AUTH_ERROR");
    }
    this.apiKey = apiKey;
  }

  private async request<T>(
    path: string,
    params?: Record<string, unknown>,
    opts?: { signal?: AbortSignal },
  ): Promise<T> {
    const url = new URL(`${BASE_URL}${path}`);
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== "") {
          url.searchParams.set(key, String(value));
        }
      });
    }

    let attempt = 0;
    for (;;) {
      const ctrl = new AbortController();
      const timer = setTimeout(
        () => ctrl.abort(),
        opts?.signal ? 15_000 : 10_000,
      );
      if (opts?.signal) {
        opts.signal.addEventListener("abort", () => ctrl.abort(), {
          once: true,
        });
      }
      try {
        const res = await fetch(url.toString(), {
          headers: { "x-api-key": this.apiKey, Accept: "application/json" },
          signal: ctrl.signal,
        });

        if (res.status === 429) {
          // The API lets us know the reset instant; the 5 req/min free tier
          // makes bursty callers hit this immediately, so honor a short wait
          // but never hang a workflow for a long window.
          const retryAfterSecs = Number(res.headers.get("retry-after") ?? 0);
          const waitMs =
            Number.isFinite(retryAfterSecs) && retryAfterSecs > 0
              ? Math.min(retryAfterSecs, 30) * 1000
              : Math.min(2 ** (attempt + 1) * 500, 4000);
          if (attempt < this.maxRetries && retryAfterSecs <= 30) {
            await new Promise((r) => setTimeout(r, waitMs));
            attempt += 1;
            continue;
          }
          const body = (await res.json().catch(() => null)) as {
            error?: string;
            message?: string;
          } | null;
          throw new APIError(
            429,
            body?.error ?? "StockTwits rate limit exceeded",
            "RATE_LIMIT",
          );
        }

        if (!res.ok) {
          let error = res.statusText;
          let code: string | undefined;
          try {
            const body = (await res.json()) as {
              error?: string;
              message?: string;
              code?: string;
            };
            if (body.message) error = body.message;
            code = body.code;
          } catch {
            // non-JSON error body; keep res.statusText
          }
          throw new APIError(res.status, error, code);
        }

        return (await res.json()) as T;
      } finally {
        clearTimeout(timer);
      }
    }
  }

  /** Fetch messages for a symbol (single page). */
  async getMessages(
    params: MessageFilters,
  ): Promise<StockTwitsMessagesResponse> {
    const { signal, ...rest } = params;
    return this.request(
      "/messages",
      {
        symbol: rest.symbol,
        ...(rest.start && { start: rest.start }),
        ...(rest.end && { end: rest.end }),
        ...(rest.limit !== undefined && { limit: rest.limit }),
        ...(rest.keyword && { keyword: rest.keyword }),
        ...(rest.username && { username: rest.username }),
        ...(rest.primaryOnly !== undefined && {
          primaryOnly: rest.primaryOnly,
        }),
        ...(rest.order && { order: rest.order }),
      },
      { signal },
    );
  }

  /** Auto-paginate through ALL messages for a symbol. */
  async getAllMessages(
    params: { symbol: string; start?: string; end?: string },
    onProgress?: (fetched: number, total: number) => void,
  ): Promise<StockTwitsMessage[]> {
    const all: StockTwitsMessage[] = [];
    let cursor: { created_at: string; id: string } | undefined;
    let hasMore = true;

    while (hasMore && all.length < 10_000) {
      const page = await this.request<StockTwitsMessagesResponse>("/messages", {
        symbol: params.symbol,
        ...(params.start && { start: params.start }),
        ...(params.end && { end: params.end }),
        limit: 1000,
        order: "asc",
        ...(cursor && {
          cursor_created_at: cursor.created_at,
          cursor_id: cursor.id,
        }),
      });
      all.push(...page.messages);
      hasMore = page.has_more;
      cursor = page.next_cursor;
      onProgress?.(all.length, page.total);
    }

    return all;
  }

  /** List all available symbols with scrape metadata. */
  async getSymbols(): Promise<{ symbols: StockTwitsSymbolInfo[] }> {
    return this.request("/symbols");
  }

  /** Currently trending symbols (server caches 5 minutes). */
  async getTrending(params?: {
    limit?: number;
    forceRefresh?: boolean;
  }): Promise<StockTwitsTrendingResponse> {
    return this.request(
      "/trending",
      params
        ? {
            limit: params.limit,
            force_refresh: params.forceRefresh,
          }
        : undefined,
    );
  }

  /** Daily message volume or hourly distribution for a symbol. */
  async getAnalytics(params: {
    type: "volume" | "hourly";
    symbol?: string;
    start?: string;
    end?: string;
  }): Promise<
    | { volume: Array<{ date: string; count: number }> }
    | { hourly: Array<{ hour: number; count: number }> }
  > {
    const { type, ...rest } = params;
    return this.request(`/analytics/${type}`, {
      ...(rest.symbol && { symbol: rest.symbol }),
      ...(rest.start && { start: rest.start }),
      ...(rest.end && { end: rest.end }),
    });
  }

  /** Real-time sentiment gauge across timeframes (15m..ALL). */
  async getSentimentDetail(params: {
    symbol: string;
    end?: string;
    forceRefresh?: boolean;
  }): Promise<Record<string, unknown>> {
    return this.request("/sentiment-detail", {
      symbol: params.symbol,
      ...(params.end && { end: params.end }),
      ...(params.forceRefresh !== undefined && {
        force_refresh: params.forceRefresh,
      }),
    });
  }

  /** Global or per-symbol aggregate statistics. */
  async getStats(params?: {
    symbol?: string;
    start?: string;
    primaryOnly?: boolean;
  }): Promise<{
    totalMessages: number;
    totalSymbols: number;
    totalUsers: number;
    totalJobs: number;
  }> {
    return this.request(
      "/stats",
      params
        ? {
            symbol: params.symbol,
            start: params.start,
            primaryOnly: params.primaryOnly,
          }
        : undefined,
    );
  }
}
