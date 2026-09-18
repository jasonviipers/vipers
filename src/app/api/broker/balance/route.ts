import { BROKER_IDS, type BrokerId } from "@/channels/broker/registry";
import {
  BrokerNotConfiguredError,
  fetchBrokerEquity,
  syncBrokerBalanceToLedger,
} from "@/lib/broker-balance";
import { getLogger, withEvlog } from "@/lib/evlog";
import { requireWriteAccess } from "@/lib/route-auth";

export const dynamic = "force-dynamic";

/** Parse + validate the ?broker= query param; defaults to OKX when absent. */
function parseBrokerId(request: Request): BrokerId | null {
  const candidate = new URL(request.url).searchParams.get("broker");
  if (candidate === null) {
    return "okx";
  }
  return (BROKER_IDS as readonly string[]).includes(candidate)
    ? (candidate as BrokerId)
    : null;
}

function errorResponse(error: unknown): Response {
  if (error instanceof BrokerNotConfiguredError) {
    return Response.json({ error: error.message }, { status: 409 });
  }
  const message =
    error instanceof Error ? error.message : "broker balance lookup failed";
  // Broker API/signature/network failures surface as 502 with the detail.
  return Response.json({ error: message }, { status: 502 });
}

/**
 * GET /api/broker/balance?broker=okx|alpaca — the connected broker's
 * account equity.
 *
 * Read endpoint (mirrors /api/broker/status): returns aggregate numbers
 * only, no secrets. The settings UI uses it to show what a sync would
 * record before the operator confirms.
 */
export const GET = withEvlog(async (request: Request) => {
  const logger = getLogger();
  logger.set({ integration: "broker" });

  const brokerId = parseBrokerId(request);
  if (!brokerId) {
    return Response.json(
      { error: `unknown broker: expected ${BROKER_IDS.join(" or ")}` },
      { status: 400 },
    );
  }
  logger.set({ brokerId });

  try {
    const equity = await fetchBrokerEquity(brokerId);
    return Response.json(equity);
  } catch (error) {
    logger.set({
      warning:
        error instanceof Error ? error.message : "broker balance unavailable",
    });
    return errorResponse(error);
  }
});

/**
 * POST /api/broker/balance?broker=okx|alpaca — reconcile the capital ledger
 * with the active broker's account equity (see syncBrokerBalanceToLedger).
 * Write-access only (demo key → 403): it records deposit/withdrawal
 * movements in the capital_transactions ledger, the same source of truth
 * the risk engine and portfolio rollups read.
 */
export const POST = withEvlog(async (request: Request) => {
  const logger = getLogger();
  logger.set({ integration: "broker" });

  const auth = requireWriteAccess(request);
  if (!auth.ok) {
    return auth.response;
  }

  const brokerId = parseBrokerId(request);
  if (!brokerId) {
    return Response.json(
      { error: `unknown broker: expected ${BROKER_IDS.join(" or ")}` },
      { status: 400 },
    );
  }
  logger.set({ brokerId });

  try {
    const result = await syncBrokerBalanceToLedger(brokerId);
    logger.set({
      audit: "broker_balance_sync",
      brokerId,
      delta: result.delta,
      equityUsd: result.equityUsd,
      mode: result.mode,
    });
    return Response.json(result);
  } catch (error) {
    logger.set({
      warning:
        error instanceof Error ? error.message : "broker balance sync failed",
    });
    return errorResponse(error);
  }
});
