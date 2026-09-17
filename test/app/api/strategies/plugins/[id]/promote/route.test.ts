import { beforeEach, describe, expect, it, mock } from "bun:test";

/**
 * Route tests for POST /api/strategies/plugins/[id]/promote.
 *
 * The DB layer and the auth guard are mocked (mock.module before importing
 * the route): the route's own logic — body validation, URL/body identity
 * agreement, and reason→HTTP status mapping — is what's under test here.
 * The auth guards have their own coverage (session-auth.ts), and the gate's
 * determinism/lineage logic has promotion-gate.test.ts.
 */

// ---------------------------------------------------------------------------
// Mocks: db (strategyPlugins lookup) + promotion-records (lineage head) +
// auth (header-driven identity) + evlog (no request scope under bun test).
// ---------------------------------------------------------------------------

let pluginRow: { configHash: string; pluginVersion: string } | undefined;
let lineageHead: {
  configHash: string;
  dataSnapshotIds: string[];
  evaluatedAt: string;
  pluginId: string;
  pluginVersion: string;
  policyHash: string;
  stage: string;
} | null;

const OPERATOR_KEY = "vps_test_operator";
const DEMO_KEY = "vps_test_demo";

mock.module("@/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => (pluginRow ? [pluginRow] : []),
        }),
      }),
    }),
  },
}));

mock.module("@/lib/promotion-records", () => ({
  appendPromotionRecord: async () => "persisted-id",
  getLatestPromotionRecord: async () => lineageHead,
  registerStrategyPlugin: async () => {},
}));

mock.module("@/lib/session-auth", () => ({
  requirePermission: (
    request: Request,
  ): { ok: true; identity: unknown } | { ok: false; response: Response } => {
    const key = request.headers.get("x-api-key");
    if (key === OPERATOR_KEY) {
      return {
        identity: { kind: "operator", subject: "operator" },
        ok: true,
      };
    }
    if (key === DEMO_KEY) {
      return {
        ok: false,
        response: Response.json(
          { error: "forbidden: the demo session is read-only" },
          { status: 403 },
        ),
      };
    }
    return {
      ok: false,
      response: Response.json(
        { error: "unauthorized: missing or invalid session" },
        { status: 401 },
      ),
    };
  },
}));

// evlog's withEvlog defers log flushing through next/server's after(), which
// only exists inside a real request scope — bun test has none. The logging
// wrapper is not under test here; pass the handler straight through.
mock.module("@/lib/evlog", () => ({
  log: { error: () => {}, warn: () => {} },
  useLogger: () => ({
    error: () => {},
    set: () => {},
    warn: () => {},
  }),
  withEvlog: (handler: unknown) => handler,
}));

const { POST } = await import(
  "@/app/api/strategies/plugins/[id]/promote/route"
);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const pluginId = "consensus-v1";
const configHash = "0".repeat(64);

function operatorRequest(body: unknown, urlPluginId = pluginId): Request {
  return new Request(
    `http://localhost/api/strategies/plugins/${urlPluginId}/promote`,
    {
      body: JSON.stringify(body),
      headers: {
        "content-type": "application/json",
        "x-api-key": OPERATOR_KEY,
      },
      method: "POST",
    },
  );
}

function routeBody(stage = "DRAFT") {
  return {
    record: {
      configHash,
      dataSnapshotIds: ["data-snapshot-1"],
      evaluatedAt: new Date().toISOString(),
      pluginId,
      pluginVersion: "consensus-v1",
      policyHash: "p".repeat(64),
      stage,
    },
    toStage: "BACKTEST",
  };
}

beforeEach(() => {
  pluginRow = { configHash, pluginVersion: "consensus-v1" };
  lineageHead = {
    configHash,
    dataSnapshotIds: ["data-snapshot-1"],
    evaluatedAt: new Date().toISOString(),
    pluginId,
    pluginVersion: "consensus-v1",
    policyHash: "p".repeat(64),
    stage: "DRAFT",
  };
});

// ---------------------------------------------------------------------------
// Auth + validation + outcome mapping
// ---------------------------------------------------------------------------

describe("POST /api/strategies/plugins/[id]/promote", () => {
  it("401s without credentials", async () => {
    const response = await POST(
      new Request(
        `http://localhost/api/strategies/plugins/${pluginId}/promote`,
        {
          body: JSON.stringify(routeBody()),
          headers: { "content-type": "application/json" },
          method: "POST",
        },
      ),
      { params: Promise.resolve({ id: pluginId }) },
    );
    expect(response.status).toBe(401);
  });

  it("403s for the read-only demo identity", async () => {
    const response = await POST(
      new Request(
        `http://localhost/api/strategies/plugins/${pluginId}/promote`,
        {
          body: JSON.stringify(routeBody()),
          headers: {
            "content-type": "application/json",
            "x-api-key": DEMO_KEY,
          },
          method: "POST",
        },
      ),
      { params: Promise.resolve({ id: pluginId }) },
    );
    expect(response.status).toBe(403);
  });

  it("400s when the record's pluginId disagrees with the URL", async () => {
    const body = routeBody();
    body.record.pluginId = "other-plugin";
    const response = await POST(operatorRequest(body), {
      params: Promise.resolve({ id: pluginId }),
    });
    expect(response.status).toBe(400);
  });

  it("400s on an invalid body", async () => {
    const response = await POST(operatorRequest({ record: { nope: true } }), {
      params: Promise.resolve({ id: pluginId }),
    });
    expect(response.status).toBe(400);
  });

  it("advances when the gate is satisfied (200 with verified manifest)", async () => {
    const response = await POST(operatorRequest(routeBody()), {
      params: Promise.resolve({ id: pluginId }),
    });
    expect(response.status).toBe(200);
    const json = (await response.json()) as {
      advanced: { stage: string };
      verifiedManifest: { pluginId: string; pluginVersion: string };
    };
    expect(json.advanced.stage).toBe("BACKTEST");
    expect(json.verifiedManifest.pluginId).toBe(pluginId);
    expect(json.verifiedManifest.pluginVersion).toBe("consensus-v1");
  });

  it("404s an unknown plugin", async () => {
    pluginRow = undefined;
    // The body must claim the ghost identity too, so the URL/body
    // agreement check passes and the DB lookup is what 404s.
    const body = routeBody();
    body.record.pluginId = "ghost-v1";
    const response = await POST(operatorRequest(body, "ghost-v1"), {
      params: Promise.resolve({ id: "ghost-v1" }),
    });
    expect(response.status).toBe(404);
  });

  it("409s a stale head", async () => {
    // Head moved to BACKTEST since the operator read the DRAFT record.
    lineageHead = {
      configHash,
      dataSnapshotIds: ["data-snapshot-1"],
      evaluatedAt: new Date().toISOString(),
      pluginId,
      pluginVersion: "consensus-v1",
      policyHash: "p".repeat(64),
      stage: "BACKTEST",
    };
    const response = await POST(operatorRequest(routeBody()), {
      params: Promise.resolve({ id: pluginId }),
    });
    expect(response.status).toBe(409);
    const json = (await response.json()) as { reason: string };
    expect(json.reason).toBe("stale-head");
  });

  it("409s when no lineage exists", async () => {
    lineageHead = null;
    const response = await POST(operatorRequest(routeBody()), {
      params: Promise.resolve({ id: pluginId }),
    });
    expect(response.status).toBe(409);
    const json = (await response.json()) as { reason: string };
    expect(json.reason).toBe("no-lineage");
  });

  it("409s an invalid transition", async () => {
    const response = await POST(
      operatorRequest({ ...routeBody(), toStage: "LIVE" }),
      { params: Promise.resolve({ id: pluginId }) },
    );
    expect(response.status).toBe(409);
    const json = (await response.json()) as { reason: string };
    expect(json.reason).toBe("invalid-transition");
  });

  it("409s an incomplete record", async () => {
    const body = routeBody();
    body.record.dataSnapshotIds = [];
    const response = await POST(operatorRequest(body), {
      params: Promise.resolve({ id: pluginId }),
    });
    expect(response.status).toBe(409);
    const json = (await response.json()) as { reason: string };
    expect(json.reason).toBe("incomplete-record");
  });
});
