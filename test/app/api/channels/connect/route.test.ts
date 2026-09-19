import { beforeEach, describe, expect, it, mock } from "bun:test";

/**
 * Route tests for POST /api/channels/connect.
 *
 * The auth guard and the Composio layer are mocked (mock.module before
 * importing the route): the route's own logic — channel validation and
 * Composio failure → HTTP status mapping — is what's under test. The auth
 * guards have their own coverage (session-auth.ts), and the Composio
 * session/authorize calls have no network under bun test by design.
 */

// ---------------------------------------------------------------------------
// Mocks: auth (header-driven identity) + composio (scriptable) + evlog.
// ---------------------------------------------------------------------------

const OPERATOR_KEY = "vps_test_operator";
const DEMO_KEY = "vps_test_demo";

let connectLinkImpl: (
  slug: string,
  callbackUrl?: string,
) => Promise<{
  connectionRequestId: string;
  redirectUrl: string;
} | null>;

let lastCallbackUrl: string | undefined;

let disconnectImpl: (slug: string) => Promise<{
  outcome: "deleted" | "no-connection" | "not-found" | "unconfigured";
}>;

mock.module("@/lib/session-auth", () => {
  // bun's module mock registry is process-global: other route tests import
  // this module too, so the mock must expose the full public surface with
  // identical header-driven semantics (whichever file's mock wins, behavior
  // matches what route tests expect).
  function authenticate(
    request: Request,
  ): { ok: true; identity: unknown } | { ok: false; response: Response } {
    const key = request.headers.get("x-api-key");
    if (key === OPERATOR_KEY) {
      return {
        identity: { kind: "operator", subject: "operator" },
        ok: true,
      };
    }
    if (key === DEMO_KEY) {
      return {
        identity: { demo: true, kind: "demo", subject: "demo" },
        ok: true,
      };
    }
    return {
      ok: false,
      response: Response.json(
        { error: "unauthorized: missing or invalid session" },
        { status: 401 },
      ),
    };
  }
  return {
    readCookie: () => null,
    requirePermission: authenticate,
    requireWriteAccess: (request: Request) => {
      const auth = authenticate(request);
      if (!auth.ok) return auth;
      const identity = auth.identity as { demo: boolean };
      if (identity.demo) {
        return {
          ok: false,
          response: Response.json(
            { error: "forbidden: identity is read-only" },
            { status: 403 },
          ),
        };
      }
      return auth;
    },
    sessionFromRequest: () => null,
  };
});

mock.module("@/lib/composio", () => ({
  CHANNEL_SLUGS: ["reddit", "twitter", "discord", "telegram"],
  createChannelConnectLink: (slug: string, callbackUrl?: string) => {
    lastCallbackUrl = callbackUrl;
    return connectLinkImpl(slug, callbackUrl);
  },
  disconnectChannel: (slug: string) => disconnectImpl(slug),
}));

// evlog's withEvlog defers log flushing through next/server's after(), which
// only exists inside a real request scope — bun test has none. The logging
// wrapper is not under test here; pass the handler straight through.
mock.module("@/lib/evlog", () => ({
  log: { error: () => {}, warn: () => {} },
  getLogger: () => ({
    error: () => {},
    set: () => {},
    warn: () => {},
  }),
  withEvlog: (handler: unknown) => handler,
}));

const { DELETE, POST } = await import("@/app/api/channels/connect/route");

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function connectRequest(body: unknown, key?: string): Request {
  return new Request("http://localhost/api/channels/connect", {
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      ...(key ? { "x-api-key": key } : {}),
    },
    method: "POST",
  });
}

beforeEach(() => {
  connectLinkImpl = async (slug: string) => ({
    connectionRequestId: `req_${slug}`,
    redirectUrl: `https://connect.composio.dev/authorize/${slug}`,
  });
  disconnectImpl = async () => ({ outcome: "deleted" as const });
  lastCallbackUrl = undefined;
});

// ---------------------------------------------------------------------------
// Auth + validation + Composio failure mapping
// ---------------------------------------------------------------------------

describe("POST /api/channels/connect", () => {
  it("401s without credentials", async () => {
    const response = await POST(connectRequest({ channel: "reddit" }));
    expect(response.status).toBe(401);
  });

  it("403s for the read-only demo identity", async () => {
    const response = await POST(
      connectRequest({ channel: "reddit" }, DEMO_KEY),
    );
    expect(response.status).toBe(403);
  });

  it("400s on an invalid body", async () => {
    const response = await POST(connectRequest({ nope: true }, OPERATOR_KEY));
    expect(response.status).toBe(400);
  });

  it("400s on a non-JSON body", async () => {
    const response = await POST(
      new Request("http://localhost/api/channels/connect", {
        body: "not-json",
        headers: {
          "content-type": "application/json",
          "x-api-key": OPERATOR_KEY,
        },
        method: "POST",
      }),
    );
    expect(response.status).toBe(400);
  });

  it("400s an unknown channel", async () => {
    const response = await POST(
      connectRequest({ channel: "gchat" }, OPERATOR_KEY),
    );
    expect(response.status).toBe(400);
  });

  it("returns the connect link for a valid channel", async () => {
    const response = await POST(
      connectRequest({ channel: "reddit" }, OPERATOR_KEY),
    );
    expect(response.status).toBe(200);
    const json = (await response.json()) as { redirectUrl: string };
    expect(json.redirectUrl).toContain("reddit");
  });

  it("503s when Composio is unconfigured", async () => {
    connectLinkImpl = async () => null;
    const response = await POST(
      connectRequest({ channel: "discord" }, OPERATOR_KEY),
    );
    expect(response.status).toBe(503);
  });

  it("502s when the Composio call throws", async () => {
    connectLinkImpl = async () => {
      throw new Error("upstream 500");
    };
    const response = await POST(
      connectRequest({ channel: "telegram" }, OPERATOR_KEY),
    );
    expect(response.status).toBe(502);
    const json = (await response.json()) as { error: string };
    expect(json.error).toContain("upstream 500");
  });

  it("503s with an explicit message when Composio rejects the key (401)", async () => {
    // Seen live: a non-Platform key in COMPOSIO_API_KEY → Composio answers
    // 401 "Invalid API key". That is a configuration error, so the route
    // maps it to 503 with actionable text instead of a generic 502.
    connectLinkImpl = async () => {
      throw new Error(
        '401 {"error":{"message":"Invalid API key: COM**Rdym","code":801}}',
      );
    };
    const response = await POST(
      connectRequest({ channel: "reddit" }, OPERATOR_KEY),
    );
    expect(response.status).toBe(503);
    const json = (await response.json()) as { error: string };
    expect(json.error).toContain("Invalid API key");
    expect(json.error).toContain("Platform project key");
  });

  it("forwards a same-origin callbackUrl to Composio", async () => {
    // The test request targets http://localhost (no port), so the callback
    // must match that origin exactly to be forwarded.
    const response = await POST(
      connectRequest(
        {
          callbackUrl: "http://localhost/channels?connected=reddit",
          channel: "reddit",
        },
        OPERATOR_KEY,
      ),
    );
    expect(response.status).toBe(200);
    expect(lastCallbackUrl).toBe("http://localhost/channels?connected=reddit");
  });

  it("drops a cross-origin callbackUrl", async () => {
    await POST(
      connectRequest(
        {
          callbackUrl: "https://evil.example/channels?connected=reddit",
          channel: "reddit",
        },
        OPERATOR_KEY,
      ),
    );
    expect(lastCallbackUrl).toBeUndefined();
  });

  it("drops an unparseable callbackUrl", async () => {
    await POST(
      connectRequest(
        { callbackUrl: "not-a-url", channel: "reddit" },
        OPERATOR_KEY,
      ),
    );
    expect(lastCallbackUrl).toBeUndefined();
  });

  // ---------------------------------------------------------------------------
  // DELETE /api/channels/connect?channel=<slug>
  // ---------------------------------------------------------------------------

  it("DELETE 401s without credentials", async () => {
    const response = await DELETE(
      new Request("http://localhost/api/channels/connect?channel=reddit", {
        method: "DELETE",
      }),
    );
    expect(response.status).toBe(401);
  });

  it("DELETE 403s for the read-only demo identity", async () => {
    const response = await DELETE(
      new Request("http://localhost/api/channels/connect?channel=reddit", {
        headers: { "x-api-key": DEMO_KEY },
        method: "DELETE",
      }),
    );
    expect(response.status).toBe(403);
  });

  it("DELETE 400s an unknown channel", async () => {
    const response = await DELETE(
      new Request("http://localhost/api/channels/connect?channel=gchat", {
        headers: { "x-api-key": OPERATOR_KEY },
        method: "DELETE",
      }),
    );
    expect(response.status).toBe(400);
  });

  it("DELETE 400s a missing channel param", async () => {
    const response = await DELETE(
      new Request("http://localhost/api/channels/connect", {
        headers: { "x-api-key": OPERATOR_KEY },
        method: "DELETE",
      }),
    );
    expect(response.status).toBe(400);
  });

  it("DELETE 200s on a deleted connection", async () => {
    disconnectImpl = async () => ({ outcome: "deleted" as const });
    const response = await DELETE(
      new Request("http://localhost/api/channels/connect?channel=reddit", {
        headers: { "x-api-key": OPERATOR_KEY },
        method: "DELETE",
      }),
    );
    expect(response.status).toBe(200);
    const json = (await response.json()) as { outcome: string };
    expect(json.outcome).toBe("deleted");
  });

  it("DELETE 409s when there is no connection to remove", async () => {
    disconnectImpl = async () => ({ outcome: "no-connection" as const });
    const response = await DELETE(
      new Request("http://localhost/api/channels/connect?channel=discord", {
        headers: { "x-api-key": OPERATOR_KEY },
        method: "DELETE",
      }),
    );
    expect(response.status).toBe(409);
  });

  it("DELETE 404s a vanished connection", async () => {
    disconnectImpl = async () => ({ outcome: "not-found" as const });
    const response = await DELETE(
      new Request("http://localhost/api/channels/connect?channel=telegram", {
        headers: { "x-api-key": OPERATOR_KEY },
        method: "DELETE",
      }),
    );
    expect(response.status).toBe(404);
  });

  it("DELETE 503s when Composio is unconfigured", async () => {
    disconnectImpl = async () => ({ outcome: "unconfigured" as const });
    const response = await DELETE(
      new Request("http://localhost/api/channels/connect?channel=reddit", {
        headers: { "x-api-key": OPERATOR_KEY },
        method: "DELETE",
      }),
    );
    expect(response.status).toBe(503);
  });

  it("DELETE 502s when the Composio call throws", async () => {
    disconnectImpl = async () => {
      throw new Error("upstream down");
    };
    const response = await DELETE(
      new Request("http://localhost/api/channels/connect?channel=reddit", {
        headers: { "x-api-key": OPERATOR_KEY },
        method: "DELETE",
      }),
    );
    expect(response.status).toBe(502);
  });
});
