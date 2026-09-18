import { alpacaClient } from "@/channels/alpaca/client";
import { ALPACA_BROKER_ID } from "@/channels/alpaca/config";
import { getBrokerCredentials } from "@/lib/broker-credentials";
import { log } from "@/lib/evlog";

/**
 * Paper-mode venue verification (checklist §7 — "Run paper mode against
 * the intended venue/account behavior").
 *
 * Two distinct paper paths exist in this codebase, and only one of them is
 * a VENUE:
 *   - OKX demo credentials → the LOCAL notional paper book
 *     (execution-tool paperResult over PAPER_BOOK_NOTIONAL_USD). No venue
 *     behavior exists to verify — there is no account, no fills, no
 *     reconciliation surface. This path can prove the pipeline plumbing,
 *     never venue behavior.
 *   - Alpaca demo (paper) credentials → the Alpaca PAPER API
 *     (paper-api.alpaca.markets): a real venue simulator with its own
 *     accounts, order lifecycle, fills, and the same REST contract as
 *     live. THIS is "the intended venue/account behavior" the checklist
 *     item means.
 *
 * The verifier below probes the Alpaca paper venue and proves, without
 * placing any order:
 *   1. route identity — the ACTIVE credential slot actually resolves to
 *      the paper endpoint family (mode: "paper"), not to live capital;
 *   2. account state — the venue answers an authenticated account read
 *      with a readable, non-negative equity (the same shape liveBalance
 *      verification consumes);
 *   3. order lifecycle readability — an order query round-trips (by client
 *      order id, the deterministic proposal-derived key execution uses),
 *      so a paper submission would be reconcilable by the existing job;
 *   4. reconciliation parity — the venue's data model (account + positions
 *      + order lookups) matches what the reconciliation job and broker
 *      adapter read on live, i.e. paper exercises the SAME code paths.
 *
 * The probe is READ-ONLY: "run paper mode against venue behavior" means
 * verifying the venue CONTRACT, not injecting synthetic orders outside the
 * consensus/risk path (orders in paper mode flow through the normal
 * pipeline: risk gate → execution tool → broker adapter, exactly like
 * live).
 *
 * The parity EVALUATION is pure (unit-testable); only `runPaperVenueProbe`
 * touches the network.
 */

export type PaperVenueCheckId =
  | "paper-route-active"
  | "account-readable"
  | "order-lifecycle-readable"
  | "reconciliation-surface-parity";

export interface PaperVenueCheck {
  check: PaperVenueCheckId;
  /** Operator-facing evidence (never includes secrets). */
  detail: string;
  ok: boolean;
}

export interface PaperVenueProbeResult {
  checks: PaperVenueCheck[];
  /** True only when EVERY check passed. */
  passed: boolean;
  venue: "alpaca-paper" | null;
}

/**
 * Pure evaluation of the venue probe observations. Kept separate from the
 * network calls so the acceptance criteria are unit-testable: every check
 * fails closed — a missing observation is a failed check, not a pass by
 * absence.
 */
export function evaluatePaperVenueProbe(observations: {
  accountEquity: number | null;
  credentialsStored: boolean;
  orderLookupOk: boolean | null;
  positionsReadable: boolean | null;
  resolvedMode: "live" | "paper" | null;
}): PaperVenueProbeResult {
  const checks: PaperVenueCheck[] = [];

  const modeArmed = observations.resolvedMode === "paper";
  checks.push({
    check: "paper-route-active",
    detail: modeArmed
      ? "ACTIVE credential slot resolves to the Alpaca PAPER endpoint family (no live capital is reachable)"
      : `ACTIVE slot resolved to ${
          observations.resolvedMode ?? "nothing (no credentials)"
        } — paper venue not active; switch EXECUTION MODE to DEMO in /settings`,
    ok: modeArmed,
  });

  const equity = observations.accountEquity;
  const accountOk = equity !== null && Number.isFinite(equity) && equity >= 0;
  checks.push({
    check: "account-readable",
    detail: accountOk
      ? `authenticated account read returned equity ${equity} USD`
      : "authenticated account read failed or returned an unreadable equity — paper venue account unusable",
    ok: accountOk,
  });

  const orderOk = observations.orderLookupOk === true;
  checks.push({
    check: "order-lifecycle-readable",
    detail: orderOk
      ? "order lookup round-trips by client_order_id — paper submissions are reconcilable"
      : "order lookup did not round-trip — paper submissions would be unreconcilable",
    ok: orderOk,
  });

  const parityOk = observations.positionsReadable === true;
  checks.push({
    check: "reconciliation-surface-parity",
    detail: parityOk
      ? "positions read uses the same adapter surface the live reconciliation job consumes"
      : "positions read failed — the reconciliation surface differs from live",
    ok: parityOk,
  });

  return {
    checks,
    passed: checks.every((c) => c.ok),
    venue: modeArmed ? "alpaca-paper" : null,
  };
}

/**
 * Probe the Alpaca paper venue with the ACTIVE credentials. Read-only;
 * never places an order. Fails closed per check — any thrown read becomes
 * a failed observation, never a skipped one.
 */
export async function runPaperVenueProbe(): Promise<PaperVenueProbeResult> {
  const stored = await getBrokerCredentials(ALPACA_BROKER_ID);
  // Stored vocabulary is "demo" | "live"; for Alpaca the demo slot IS the
  // paper venue (createAlpacaConfig maps demo → paper-api host). Re-derived
  // below so the check reflects endpoint truth, not just the slot label.
  let resolvedMode: "live" | "paper" | null =
    stored?.mode === "live" ? "live" : stored ? "paper" : null;

  // Belt and braces: re-derive the endpoint family the client will
  // actually use, so the check reflects routing truth, not just the
  // stored slot label.
  if (stored) {
    try {
      const { createAlpacaConfig } = await import("@/channels/alpaca/config");
      resolvedMode = (await createAlpacaConfig()).mode;
    } catch {
      resolvedMode = null;
    }
  }

  let accountEquity: number | null = null;
  let orderLookupOk: boolean | null = null;
  let positionsReadable: boolean | null = null;

  if (stored) {
    try {
      const account = await alpacaClient.getAccount();
      const equity = Number(account?.equity);
      accountEquity = Number.isFinite(equity) ? equity : null;
    } catch {
      accountEquity = null;
    }
    try {
      // Deterministic probe key; the lookup may come back null (no such
      // order) — a well-formed empty answer still proves the contract
      // round-trips with authentication. Only HTTP/transport failures throw.
      await alpacaClient.findOrderByClientOrderId("paper-venue-probe-00000000");
      orderLookupOk = true;
    } catch {
      orderLookupOk = false;
    }
    try {
      await alpacaClient.getPositions();
      positionsReadable = true;
    } catch {
      positionsReadable = false;
    }
  } else {
    accountEquity = null;
    orderLookupOk = null;
    positionsReadable = null;
  }

  const result = evaluatePaperVenueProbe({
    accountEquity,
    credentialsStored: Boolean(stored),
    orderLookupOk,
    positionsReadable,
    resolvedMode,
  });

  log.info({
    audit: "paper_venue_probe",
    passed: result.passed,
    venue: result.venue,
  });
  return result;
}
