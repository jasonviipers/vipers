/**
 * RISK team logic: the mandatory gate. Consensus approval is advisory; only
 * a RISK_APPROVED proposal may proceed to execution.
 *
 * Hard limits are evaluated FIRST — an armed kill switch or a breached
 * daily-loss cap rejects a proposal before any sizing logic runs. Daily
 * realized P&L is read from the capital ledger (the same source of truth
 * the portfolio jobs use), so the cap is real, not cosmetic.
 */

import { and, desc, eq, gte, sql } from "drizzle-orm";

import { db } from "@/db";
import { capitalTransactions, portfolioSnapshots } from "@/db/schema/portfolio";
import { riskControls } from "@/db/schema/risk";
import { positions } from "@/db/schema/trading";
import { readLedgerAccountBalance } from "@/lib/capital-ledger";
import { log } from "@/lib/evlog";
import { getRuntimeSettings } from "@/lib/runtime-settings";
import { fetchMarketQuote } from "./market-quote-tool";

export interface RiskLimits {
  /** Max realized daily loss, percent of current total capital. */
  maxDailyLossPct: number;
  /** Max position size, percent of book. */
  maxPositionPct: number;
  maxConcentrationPct?: number;
  maxCorrelation?: number;
  maxDrawdownPct?: number;
  maxLeverage?: number;
  maxSpreadBps?: number;
  maxVolatilityPct?: number;
}

export interface RiskEvaluation {
  approved: boolean;
  positionSizePct: number;
  reason: string;
}

export interface RiskGateContext {
  /** Armed kill switch blocks new exposure; protective reductions may pass. */
  killSwitchEnabled: boolean;
  currentConcentrationPct?: number;
  currentCorrelation?: number;
  currentDrawdownPct?: number;
  currentLeverage?: number;
  currentVolatilityPct?: number;
  spreadBps?: number;
  /** Realized P&L so far today (realized_pnl − fees), currency units. */
  dailyRealizedPnl: number;
  /** Current total capital, currency units (denominator for the loss cap). */
  totalCapital: number;
  /** Currently OPEN position count (operator cap from runtime settings). */
  openPositions: number;
  /** Max concurrent open positions (operator setting; null = uncapped). */
  maxOpenPositions: number | null;
}

const MIN_CONFIDENCE_FLOOR = 0.6;
const MAX_MARKET_DATA_AGE_MS = 30_000;

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
/**
 * Currently OPEN position count — feeds the operator's max-open-positions
 * cap (runtime settings) in the risk gate.
 */
export async function fetchOpenPositionsCount(): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(positions)
    .where(eq(positions.status, "OPEN"));
  return rows[0]?.count ?? 0;
}

export async function fetchTotalCapital(): Promise<number> {
  // Once the independent ledger has a posted cash movement, it becomes the
  // preferred capital source. The legacy projection remains the fallback
  // during migration and for fresh installs with no ledger entries.
  const ledgerCash = await readLedgerAccountBalance("assets:cash", "USDT");
  if (ledgerCash !== null) {
    const [open] = await db
      .select({ openPnl: sql<string>`coalesce(sum(${positions.pnl}), '0')` })
      .from(positions)
      .where(eq(positions.status, "OPEN"));
    return ledgerCash + Number(open?.openPnl ?? 0);
  }

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
    proposedLeverage?: number;
    proposedPositionPct?: number;
    reducesRisk?: boolean;
    riskType?: "NEW_RISK" | "PROTECTIVE_REDUCTION";
  },
  limits: RiskLimits,
  context: RiskGateContext,
): RiskEvaluation {
  // Protective reductions have a separate, narrower path so a new-risk halt
  // cannot trap an existing position. The caller must explicitly assert that
  // the operation reduces exposure; the broker adapter still constrains it.
  if (input.riskType === "PROTECTIVE_REDUCTION") {
    if (!input.reducesRisk) {
      return {
        approved: false,
        positionSizePct: 0,
        reason: "Protective reduction rejected: reduction flag was not proven",
      };
    }
    return {
      approved: true,
      positionSizePct: Math.min(
        100,
        Math.max(0, input.proposedPositionPct ?? 100),
      ),
      reason: context.killSwitchEnabled
        ? "Protective reduction approved while new-risk kill switch is armed"
        : "Protective reduction approved",
    };
  }

  // 1. Kill switch — dead-man priority over new exposure.
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

  // 2b. Operator concurrency cap on open positions (runtime settings).
  if (
    context.maxOpenPositions !== null &&
    context.openPositions >= context.maxOpenPositions
  ) {
    return {
      approved: false,
      positionSizePct: 0,
      reason: `Open positions (${context.openPositions}) reached the operator cap of ${context.maxOpenPositions}`,
    };
  }

  // 3. Portfolio safety axes. Missing optional measurements are handled by
  // the server path as unavailable data; the pure core remains reusable.
  if (
    limits.maxLeverage !== undefined &&
    input.proposedLeverage !== undefined &&
    input.proposedLeverage > limits.maxLeverage
  ) {
    return {
      approved: false,
      positionSizePct: 0,
      reason: "Leverage limit exceeded",
    };
  }
  if (
    limits.maxConcentrationPct !== undefined &&
    context.currentConcentrationPct !== undefined &&
    context.currentConcentrationPct + (input.proposedPositionPct ?? 0) >
      limits.maxConcentrationPct
  ) {
    return {
      approved: false,
      positionSizePct: 0,
      reason: "Concentration limit exceeded",
    };
  }
  if (
    limits.maxCorrelation !== undefined &&
    context.currentCorrelation !== undefined &&
    context.currentCorrelation > limits.maxCorrelation
  ) {
    return {
      approved: false,
      positionSizePct: 0,
      reason: "Correlation limit exceeded",
    };
  }
  if (
    limits.maxDrawdownPct !== undefined &&
    context.currentDrawdownPct !== undefined &&
    context.currentDrawdownPct >= limits.maxDrawdownPct
  ) {
    return {
      approved: false,
      positionSizePct: 0,
      reason: "Drawdown limit reached",
    };
  }
  if (
    limits.maxVolatilityPct !== undefined &&
    context.currentVolatilityPct !== undefined &&
    context.currentVolatilityPct > limits.maxVolatilityPct
  ) {
    return {
      approved: false,
      positionSizePct: 0,
      reason: "Volatility limit exceeded",
    };
  }
  if (
    limits.maxSpreadBps !== undefined &&
    context.spreadBps !== undefined &&
    context.spreadBps > limits.maxSpreadBps
  ) {
    return {
      approved: false,
      positionSizePct: 0,
      reason: "Spread limit exceeded",
    };
  }

  // 4. Confidence floor.
  if (input.confidence < MIN_CONFIDENCE_FLOOR) {
    return {
      approved: false,
      positionSizePct: 0,
      reason: `Confidence ${input.confidence} below the ${MIN_CONFIDENCE_FLOOR} hard floor`,
    };
  }

  // 5. Confidence-scaled sizing, capped at the configured maximum.
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
  let operatorMaxDailyLossPct: number;
  try {
    // The operator's runtime-settings daily-loss cap overrides the
    // agent-config default when present.
    const [
      runtime,
      killSwitchEnabled,
      dailyRealizedPnl,
      totalCapital,
      openPositions,
      quote,
    ] = await Promise.all([
      getRuntimeSettings(),
      isKillSwitchEnabled(),
      fetchDailyRealizedPnl(),
      fetchTotalCapital(),
      fetchOpenPositionsCount(),
      fetchMarketQuote(input.asset),
    ]);
    const quoteAgeMs = Date.now() - quote.fetchedAt;
    if (quote.stale || quoteAgeMs > MAX_MARKET_DATA_AGE_MS) {
      return {
        approved: false,
        positionSizePct: 0,
        reason: `Market quote is stale (${Math.max(0, Math.round(quoteAgeMs / 1000))}s old); proposal rejected`,
      };
    }
    context = {
      dailyRealizedPnl,
      killSwitchEnabled,
      maxOpenPositions: runtime.maxOpenPositions,
      openPositions,
      totalCapital,
    };
    operatorMaxDailyLossPct = runtime.maxDailyLossPct;
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

  // Operator override: the runtime-settings daily-loss cap replaces the
  // agent-config default (maxDailyLossPct is always > 0 in the schema).
  const effectiveLimits: RiskLimits = {
    ...limits,
    maxDailyLossPct: operatorMaxDailyLossPct || limits.maxDailyLossPct,
  };

  return evaluateProposalRisk(input, effectiveLimits, context);
}
