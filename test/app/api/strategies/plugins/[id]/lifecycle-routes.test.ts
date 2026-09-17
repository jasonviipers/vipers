import { beforeEach, describe, expect, it, mock } from "bun:test";

/**
 * Route tests for POST .../disable and POST .../reactivate. The DB layer
 * and auth guard are mocked; the routes' own logic — body validation,
 * reason→status mapping — is what's under test.
 *
 * The REGISTRY module is deliberately NOT mocked: bun's mock.module is
 * process-global across test files, and mocking it would poison other
 * suites importing the real registry. Instead these tests register the
 * real consensus plugin (idempotent, server-owned fixtures), so fixture
 * verification runs for real. Drift-refusal semantics are covered at the
 * unit level (strategy-lifecycle.test.ts) via the injected verifier.
 */

let lifecyclePlugins: Record<string, { configHash: string; enabled: boolean }> =
  {};
let lifecycleCurrentIdValue = "consensus-v1";
function lifecycleCurrentId(): string {
  return lifecycleCurrentIdValue;
}

const OPERATOR_KEY = "vps_test_operator";
const DEMO_KEY = "vps_test_demo";

mock.module("@/db", () => ({
  db: {
    insert: () => ({
      values: () => ({
        returning: async () => [{ id: "record-id" }],
      }),
    }),
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => {
            const id = lifecycleCurrentId();
            const row = lifecyclePlugins[id];
            return row ? [{ ...row, pluginId: id }] : [];
          },
        }),
      }),
    }),
    update: () => ({
      set: (values: { enabled?: boolean }) => ({
        where: async () => {
          const row = lifecyclePlugins[lifecycleCurrentId()];
          if (row && values.enabled !== undefined) {
            row.enabled = values.enabled;
          }
        },
      }),
    }),
  },
}));

mock.module("@/lib/promotion-records", () => ({
  appendPromotionRecord: async () => "appended-id",
  getLatestPromotionRecord: async (pluginId: string) => ({
    configHash: "0".repeat(64),
    dataSnapshotIds: ["snapshot-1"],
    evaluatedAt: new Date().toISOString(),
    metrics: null,
    pluginId,
    pluginVersion: "consensus-v1",
    policyHash: "p".repeat(64),
    stage: "PAPER",
  }),
  registerStrategyPlugin: async () => {},
}));

mock.module("@/lib/session-auth", () => ({
  requirePermission: (
    request: Request,
  ): { ok: true; identity: unknown } | { ok: false; response: Response } => {
    const key = request.headers.get("x-api-key");
    if (key === OPERATOR_KEY) {
      return { identity: { kind: "operator", subject: "operator" }, ok: true };
    }
    if (key === DEMO_KEY) {
      return {
        ok: false,
        response: Response.json({ error: "forbidden" }, { status: 403 }),
      };
    }
    return {
      ok: false,
      response: Response.json({ error: "unauthorized" }, { status: 401 }),
    };
  },
}));

mock.module("@/lib/evlog", () => ({
  log: { error: () => {}, warn: () => {} },
  useLogger: () => ({ error: () => {}, set: () => {}, warn: () => {} }),
  withEvlog: (handler: unknown) => handler,
}));

const { POST: disablePost } = await import(
  "@/app/api/strategies/plugins/[id]/disable/route"
);
const { POST: reactivatePost } = await import(
  "@/app/api/strategies/plugins/[id]/reactivate/route"
);

// The REAL registry: register the built-in plugin so the routes' fixture
// verification (through the isolated worker) exercises the real path.
const {
  CONSENSUS_PLUGIN_FIXTURES,
  CONSENSUS_PLUGIN_MANIFEST,
  CONSENSUS_PLUGIN_SOURCE,
} = await import("@/ai/capital-engine/plugin-runtime");
const { registerStrategyPluginSource } = await import(
  "@/ai/capital-engine/strategy-registry"
);

function request(body: unknown, key: string, base: string): Request {
  return new Request(`http://localhost${base}`, {
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
    },
    method: "POST",
  });
}

const paramsFor = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  lifecycleCurrentIdValue = "consensus-v1";
  lifecyclePlugins = {
    "consensus-v1": { configHash: "0".repeat(64), enabled: true },
  };
});

describe("POST /api/strategies/plugins/[id]/disable", () => {
  it("401s without credentials", async () => {
    const response = await disablePost(
      request(
        { reason: "operator" },
        "",
        `/api/strategies/plugins/consensus-v1/disable`,
      ),
      paramsFor("consensus-v1"),
    );
    expect(response.status).toBe(401);
  });

  it("403s the read-only demo identity", async () => {
    const response = await disablePost(
      request(
        { reason: "operator" },
        DEMO_KEY,
        `/api/strategies/plugins/consensus-v1/disable`,
      ),
      paramsFor("consensus-v1"),
    );
    expect(response.status).toBe(403);
  });

  it("400s an invalid reason", async () => {
    const response = await disablePost(
      request(
        { reason: "because" },
        OPERATOR_KEY,
        `/api/strategies/plugins/consensus-v1/disable`,
      ),
      paramsFor("consensus-v1"),
    );
    expect(response.status).toBe(400);
  });

  it("200s and reports the prior stage on success", async () => {
    const response = await disablePost(
      request(
        { reason: "risk-breach", reasonDetail: "daily loss 3.4% vs 3% cap" },
        OPERATOR_KEY,
        `/api/strategies/plugins/consensus-v1/disable`,
      ),
      paramsFor("consensus-v1"),
    );
    expect(response.status).toBe(200);
    const json = (await response.json()) as {
      disabled: boolean;
      previousStage: string;
    };
    expect(json.disabled).toBe(true);
    expect(json.previousStage).toBe("PAPER");
  });

  it("404s an unknown plugin", async () => {
    lifecycleCurrentIdValue = "ghost-v1";
    const response = await disablePost(
      request(
        { reason: "operator" },
        OPERATOR_KEY,
        `/api/strategies/plugins/ghost-v1/disable`,
      ),
      paramsFor("ghost-v1"),
    );
    expect(response.status).toBe(404);
  });
});

describe("POST /api/strategies/plugins/[id]/reactivate", () => {
  beforeEach(() => {
    // Reactivation only applies to a disabled plugin.
    lifecyclePlugins["consensus-v1"] = {
      configHash: "0".repeat(64),
      enabled: false,
    };
  });

  it("registers fixtures, then 200s and re-enables after real fixture proof", async () => {
    await registerStrategyPluginSource({
      fixtures: CONSENSUS_PLUGIN_FIXTURES,
      manifest: CONSENSUS_PLUGIN_MANIFEST,
      source: CONSENSUS_PLUGIN_SOURCE,
    });
    const response = await reactivatePost(
      request(
        undefined,
        OPERATOR_KEY,
        `/api/strategies/plugins/consensus-v1/reactivate`,
      ),
      paramsFor("consensus-v1"),
    );
    expect(response.status).toBe(200);
    const json = (await response.json()) as { stage: string };
    expect(json.stage).toBe("DRAFT");
  });

  it("403s the demo identity", async () => {
    const response = await reactivatePost(
      request(
        undefined,
        DEMO_KEY,
        `/api/strategies/plugins/consensus-v1/reactivate`,
      ),
      paramsFor("consensus-v1"),
    );
    expect(response.status).toBe(403);
  });
});
