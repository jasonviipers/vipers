/**
 * RISK team logic: the mandatory gate. Consensus approval is advisory; only
 * a RISK_APPROVED proposal may proceed to execution.
 *
 * Hard limits are evaluated FIRST — an armed kill switch or a breached
 * daily-loss cap rejects a proposal before any sizing logic runs. Daily
 * realized P&L is read from the capital ledger (the same source of truth
 * the portfolio jobs use), so the cap is real, not cosmetic.
 */

import { and, desc, gte, sql } from "drizzle-orm";

import { db } from "@/db";
import { capitalTransactions, portfolioSnapshots } from "@/db/schema/portfolio";
import { riskControls } from "@/db/schema/risk";
import { log } from "@/lib/evlog";

export interface RiskLimits {
  /** Max realized daily loss, percent of current total capital. */
  maxDailyLossPct: number;
  /** Max position size, percent of book. */
  maxPositionPct: number;
}

export interface RiskEvaluation {
  approved: boolean;
  positionSizePct: number;
  reason: string;
}

export interface RiskGateContext {
  /** Armed kill switch blocks every proposal before any other check. */
  killSwitchEnabled: boolean;
  /** Realized P&L so far today (realized_pnl − fees), currency units. */
  dailyRealizedPnl: number;
  /** Current total capital, currency units (denominator for the loss cap). */
  totalCapital: number;
}

const MIN_CONFIDENCE_FLOOR = 0.6;

function startOfLocalDay(): Date {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return now;
}

/**
 * Server-owned kill switch (risk_controls singleton, id = "global").
 * The /settings toggle writes this via POST /api/risk/kill-switch; the
 * gate reads it before evaluating anything.
 */
export async function isKillSwitchEnabled(): Promise<boolean> {
  const [row] = await db
    .select({ enabled: riskControls.killSwitchEnabled })
    .from(riskControls)
    .where(sql`${riskControls.id} = 'global'`);
  return row?.enabled ?? false;
}

/**
 * Realized P&L so far today from the capital ledger: realized_pnl credits
 * and debits minus fees. Matches the ledger convention used by the
 * portfolio snapshot job (fee rows carry positive amounts and are spent).
 */
export async function fetchDailyRealizedPnl(): Promise<number> {
  const rows = await db
    .select({
      total: sql<string>`coalesce(sum(
        case
          when ${capitalTransactions.type} = 'realized_pnl' then ${capitalTransactions.amount}
          when ${capitalTransactions.type} = 'fee' then -${capitalTransactions.amount}
          else 0
        end
      ), '0')`,
    })
    .from(capitalTransactions)
    .where(
      and(
        gte(capitalTransactions.createdAt, startOfLocalDay()),
        sql`${capitalTransactions.type} in ('realized_pnl', 'fee')`,
      ),
    );
  return Number(rows[0]?.total ?? 0);
}

/**
 * Total capital from the latest portfolio snapshot (the hourly rollup the
 * dashboard equity curve also reads). Falls back to the cumulative ledger
 * net when no snapshot exists yet (fresh install).
 */
export async function fetchTotalCapital(): Promise<number> {
  const [snapshot] = await db
    .select({ totalCapital: portfolioSnapshots.totalCapital })
    .from(portfolioSnapshots)
    .orderBy(desc(portfolioSnapshots.takenAt))
    .limit(1);
  if (snapshot) {
    return Number(snapshot.totalCapital);
  }

  const [pre] = await db
    .select({
      net: sql<string>`coalesce(sum(
        case
          when ${capitalTransactions.type} = 'deposit' then ${capitalTransactions.amount}
          when ${capitalTransactions.type} = 'withdrawal' then -${capitalTransactions.amount}
          when ${capitalTransactions.type} = 'realized_pnl' then ${capitalTransactions.amount}
          else -${capitalTransactions.amount}
        end
      ), '0')`,
    })
    .from(capitalTransactions);
  return Number(pre?.net ?? 0);
}

/**
 * Pure decision core: same rules the gate applies, no I/O. Hard limits
 * first (kill switch → daily loss), then the confidence floor, then
 * confidence-scaled sizing capped at the configured maximum.
 */
export function evaluateProposalRisk(
  input: {
    asset: string;
    confidence: number;
  },
  limits: RiskLimits,
  context: RiskGateContext,
): RiskEvaluation {
  // 1. Kill switch — dead-man priority over everything.
  if (context.killSwitchEnabled) {
    return {
      approved: false,
      positionSizePct: 0,
      reason: "KILL SWITCH ARMED — all order submission halted",
    };
  }

  // 2. Daily loss cap — percent of current total capital, from the ledger.
  //    The cap blocks further trades for the rest of the day once reached;
  //    a new signal must not reopen the door.
  if (context.totalCapital > 0) {
    const lossMagnitude =
      context.dailyRealizedPnl < 0 ? -context.dailyRealizedPnl : 0;
    const dailyLossPct = (lossMagnitude / context.totalCapital) * 100;
    if (dailyLossPct >= limits.maxDailyLossPct) {
      return {
        approved: false,
        positionSizePct: 0,
        reason: `Daily loss ${dailyLossPct.toFixed(2)}% reached the ${limits.maxDailyLossPct}% cap — no further trades today`,
      };
    }
  }

  // 3. Confidence floor.
  if (input.confidence < MIN_CONFIDENCE_FLOOR) {
    return {
      approved: false,
      positionSizePct: 0,
      reason: `Confidence ${input.confidence} below the ${MIN_CONFIDENCE_FLOOR} hard floor`,
    };
  }

  // 4. Confidence-scaled sizing, capped at the configured maximum.
  const positionSizePct = Number(
    Math.min(
      limits.maxPositionPct,
      input.confidence * limits.maxPositionPct,
    ).toFixed(2),
  );

  return {
    approved: true,
    positionSizePct,
    reason: `Within limits: ${positionSizePct}% of book on ${input.asset}, daily loss cap ${limits.maxDailyLossPct}%`,
  };
}

/**
 * The production gate used by the consensus workflow and the evaluateRisk
 * tool binding: reads the kill switch + ledger + snapshot, then applies the
 * pure decision core. Any lookup failure fails CLOSED — the proposal is
 * rejected rather than approved on missing risk data.
 */
export async function evaluateProposalRiskServer(
  input: { asset: string; confidence: number },
  limits: RiskLimits,
): Promise<RiskEvaluation> {
  let context: RiskGateContext;
  try {
    const [killSwitchEnabled, dailyRealizedPnl, totalCapital] =
      await Promise.all([
        isKillSwitchEnabled(),
        fetchDailyRealizedPnl(),
        fetchTotalCapital(),
      ]);
    context = { dailyRealizedPnl, killSwitchEnabled, totalCapital };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown";
    log.error(
      error instanceof Error
        ? error
        : new Error("risk-gate lookups failed — failing closed"),
    );
    return {
      approved: false,
      positionSizePct: 0,
      reason: `Risk data unavailable — proposal rejected (fail closed): ${detail}`,
    };
  }

  return evaluateProposalRisk(input, limits, context);
}
