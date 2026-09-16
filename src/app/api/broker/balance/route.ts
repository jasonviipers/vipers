import {
  BrokerNotConfiguredError,
  fetchBrokerEquity,
  syncBrokerBalanceToLedger,
} from "@/lib/broker-balance";
import { useLogger, withEvlog } from "@/lib/evlog";
import { requireWriteAccess } from "@/lib/route-auth";

export const dynamic = "force-dynamic";

function errorResponse(error: unknown): Response {
  if (error instanceof BrokerNotConfiguredError) {
    return Response.json({ error: error.message }, { status: 409 });
  }
  const message =
    error instanceof Error ? error.message : "broker balance lookup failed";
  // OKX API/signature/network failures surface as 502 with the detail.
  return Response.json({ error: message }, { status: 502 });
}

/**
 * GET /api/broker/balance — the connected OKX account equity.
 *
 * Read endpoint (mirrors /api/broker/status): returns aggregate numbers
 * only, no secrets. The settings UI uses it to show what a sync would
 * record before the operator confirms.
 */
export const GET = withEvlog(async () => {
  const logger = useLogger();
  logger.set({ integration: "broker" });

  try {
    const equity = await fetchBrokerEquity();
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
 * POST /api/broker/balance — reconcile the capital ledger with the live
 * OKX account equity (see syncBrokerBalanceToLedger). Write-access only
 * (demo key → 403): it records deposit/withdrawal movements in the
 * capital_transactions ledger, the same source of truth the risk engine
 * and portfolio rollups read.
 */
export const POST = withEvlog(async (request: Request) => {
  const logger = useLogger();
  logger.set({ integration: "broker" });

  const auth = requireWriteAccess(request);
  if (!auth.ok) {
    return auth.response;
  }

  try {
    const result = await syncBrokerBalanceToLedger();
    logger.set({
      audit: "broker_balance_sync",
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
