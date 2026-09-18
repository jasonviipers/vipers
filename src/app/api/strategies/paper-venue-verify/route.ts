import { runPaperVenueProbe } from "@/ai/capital-engine/paper-venue-verify";
import { getLogger, withEvlog } from "@/lib/evlog";
import { requireWriteAccess } from "@/lib/route-auth";

export const dynamic = "force-dynamic";

/**
 * POST /api/strategies/paper-venue-verify — probe the intended paper venue
 * (checklist §7: "Run paper mode against the intended venue/account
 * behavior").
 *
 * Read-only against the venue: proves the ACTIVE Alpaca credential slot
 * resolves to the PAPER endpoint family, the account read authenticates,
 * the order-query contract round-trips by client_order_id, and the
 * positions surface matches what live reconciliation consumes. Never
 * places an order — paper orders flow through the normal consensus → risk
 * → execution path exactly like live ones.
 *
 * Write-access only (demo key → 403): it is an operational readiness
 * trigger, and a failing probe names the exact fix (e.g. switch EXECUTION
 * MODE to DEMO) in each failed check's detail.
 */
export const POST = withEvlog(async (request: Request) => {
  const logger = getLogger();
  logger.set({ integration: "strategies" });

  const auth = requireWriteAccess(request);
  if (!auth.ok) {
    return auth.response;
  }

  const result = await runPaperVenueProbe();
  logger.set({
    audit: "paper_venue_verify",
    passed: result.passed,
    venue: result.venue,
  });
  return Response.json(result, { status: result.passed ? 200 : 503 });
});
