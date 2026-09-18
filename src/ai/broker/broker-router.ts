/**
 * Active-broker routing — the single place that decides WHERE an order goes.
 *
 * The active broker id is a durable runtime setting ({@link getRuntimeSettings}),
 * never client state. Credential mode (demo/live slot) resolves to an
 * execution route per broker:
 *
 *   OKX    — unchanged semantics: demo creds → local paper book, live creds
 *            → OKX live API, none → paper book / blocked in production.
 *   Alpaca — demo creds → Alpaca PAPER API, live creds → Alpaca live API,
 *            none → local paper book / blocked in production. Alpaca demo
 *            orders therefore have persistence mode "live": they are backed
 *            by a real broker API and must be reconcilable.
 *
 * `mode` is the persistence mode recorded on the `orders` row (which the
 * reconciliation job filters on); `executionRoute` is the immediate
 * execution path (local stub vs broker adapter).
 */

import { resolveExecutionRoute } from "@/ai/capital-engine/execution-mode";
import { type BrokerId, isKnownBroker } from "@/channels/broker/registry";
import { getBrokerCredentials } from "@/lib/broker-credentials";
import { getRuntimeSettings } from "@/lib/runtime-settings";

export type BrokerRoute =
  | { status: "blocked" }
  | {
      brokerId: BrokerId;
      executionRoute: "live" | "paper";
      mode: "live" | "paper";
      status: "ok";
    };

export async function resolveActiveBrokerRoute(input: {
  nodeEnvironment: "development" | "test" | "production";
}): Promise<BrokerRoute> {
  const { activeBrokerId } = await getRuntimeSettings();
  const brokerId: BrokerId = isKnownBroker(activeBrokerId)
    ? activeBrokerId
    : "okx";

  if (brokerId === "okx") {
    const route = resolveExecutionRoute({
      credentialMode: (await getBrokerCredentials("okx"))?.mode ?? null,
      nodeEnvironment: input.nodeEnvironment,
    });
    if (route === "blocked") {
      return { status: "blocked" };
    }
    return { brokerId, executionRoute: route, mode: route, status: "ok" };
  }

  // Alpaca: any stored credentials (demo OR live) route to a real Alpaca
  // API; only an unconfigured Alpaca falls back to the paper book/stub.
  const credentialMode = (await getBrokerCredentials("alpaca"))?.mode ?? null;
  if (credentialMode !== null) {
    return { brokerId, executionRoute: "live", mode: "live", status: "ok" };
  }
  const route = resolveExecutionRoute({
    credentialMode: null,
    nodeEnvironment: input.nodeEnvironment,
  });
  if (route === "blocked") {
    return { status: "blocked" };
  }
  return { brokerId, executionRoute: route, mode: route, status: "ok" };
}
