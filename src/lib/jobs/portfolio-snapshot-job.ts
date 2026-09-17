import { eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { capitalTransactions, portfolioSnapshots } from "@/db/schema/portfolio";
import { positions } from "@/db/schema/trading";
import { readLedgerAccountBalance } from "@/lib/capital-ledger";
import { log } from "@/lib/evlog";

/**
 * Portfolio snapshot rollup job.
 *
 * Writes one `portfolio_snapshots` row per run so the dashboard equity curve
 * has history. Capital is derived from the ledger (the source of truth, per
 * schema comments — balances are never stored raw):
 *
 *   totalCapital      = deposits - withdrawals + realized P&L + fees + open PnL
 *   investedCapital   = sum over OPEN positions of |entry notional|
 *   availableCapital  = totalCapital - investedCapital (floor 0)
 *
 * Open PnL comes from `positions.pnl` (cached by the price-tick job).
 *
 * Idempotent per hour: if a snapshot already exists for the current
 * clock-hour it is updated in place, so app restarts or overlapping runs
 * never duplicate rows — the equity curve gets one point per hour max.
 */
interface CapitalAtPoint {
  accountId: string;
  availableCapital: string;
  investedCapital: string;
  takenAt: Date;
  totalCapital: string;
}

export interface LedgerCapital {
  availableCapital: number;
  investedCapital: number;
  openPnl: number;
  totalCapital: number;
}

/**
 * Derive capital from the ledger (the source of truth) plus open positions:
 *
 *   totalCapital     = deposits - withdrawals + realized P&L - fees + open PnL
 *   investedCapital  = sum over OPEN positions of entry notional
 *   availableCapital = totalCapital - investedCapital (floor 0)
 *
 * Shared by the snapshot rollup and the OKX balance sync so both agree on
 * what "current capital" means.
 */
export async function computeLedgerCapital(): Promise<LedgerCapital> {
  const independentCash = await readLedgerAccountBalance("assets:cash", "USDT");
  if (independentCash !== null) {
    const [open] = await db
      .select({
        openPnl: sql<string>`coalesce(sum(${positions.pnl}), '0')`,
        invested: sql<string>`coalesce(sum(${positions.entryPrice} * ${positions.quantity}), '0')`,
      })
      .from(positions)
      .where(eq(positions.status, "OPEN"));
    const openPnl = Number(open?.openPnl ?? 0);
    const investedCapital = Number(open?.invested ?? 0);
    const totalCapital = independentCash + openPnl;
    return {
      availableCapital: Math.max(0, totalCapital - investedCapital),
      investedCapital,
      openPnl,
      totalCapital,
    };
  }

  const [flows] = await db
    .select({
      deposits: sql<string>`coalesce(sum(${sql.raw(
        "case when type = 'deposit' then amount else 0 end",
      )}), '0')`,
      withdrawals: sql<string>`coalesce(sum(${sql.raw(
        "case when type = 'withdrawal' then amount else 0 end",
      )}), '0')`,
      // Realized P&L net of fees. Deposits/withdrawals are capital flows,
      // not P&L, so they contribute nothing here (they enter via the
      // deposits/withdrawals columns above).
      realizedNet: sql<string>`coalesce(sum(${sql.raw(
        "case when type = 'realized_pnl' then amount when type = 'fee' then -amount else 0 end",
      )}), '0')`,
    })
    .from(capitalTransactions);

  const [open] = await db
    .select({
      openPnl: sql<string>`coalesce(sum(${positions.pnl}), '0')`,
      invested: sql<string>`coalesce(sum(${positions.entryPrice} * ${positions.quantity}), '0')`,
    })
    .from(positions)
    .where(eq(positions.status, "OPEN"));

  const deposits = Number(flows?.deposits ?? 0);
  const withdrawals = Number(flows?.withdrawals ?? 0);
  const realizedNet = Number(flows?.realizedNet ?? 0);
  const openPnl = Number(open?.openPnl ?? 0);
  const investedCapital = Number(open?.invested ?? 0);

  const totalCapital = deposits - withdrawals + realizedNet + openPnl;
  const availableCapital = Math.max(0, totalCapital - investedCapital);

  return { availableCapital, investedCapital, openPnl, totalCapital };
}

/**
 * Backfill hourly snapshots from the historical ledger so the equity curve
 * starts populated instead of waiting a day for the hourly job.
 *
 * Replays `capital_transactions` chronologically, computing running capital
 * at each hour boundary over the requested window (default 7 days), then
 * inserts any missing snapshot rows. Already-existing hours are skipped, so
 * the backfill is idempotent and never clobbers live rollups. Open-position
 * PnL is intentionally excluded from historical points — the ledger carries
 * only realized history, and inventing unrealized values for past hours
 * would fabricate data; the curve converges with live rollups going forward.
 */
export async function backfillPortfolioSnapshots({
  days = 7,
}: {
  days?: number;
} = {}): Promise<number> {
  try {
    const windowStart = new Date();
    windowStart.setMinutes(0, 0, 0);
    windowStart.setHours(windowStart.getHours() - days * 24);

    // Chronological ledger movements within the window.
    const movements = await db
      .select({
        amount: capitalTransactions.amount,
        createdAt: capitalTransactions.createdAt,
        type: capitalTransactions.type,
      })
      .from(capitalTransactions)
      .where(
        sql`${capitalTransactions.createdAt} >= ${windowStart.toISOString()}::timestamptz`,
      )
      .orderBy(capitalTransactions.createdAt);

    // Existing hours (any source) are never overwritten.
    const existing = await db
      .select({ takenAt: portfolioSnapshots.takenAt })
      .from(portfolioSnapshots)
      .where(
        sql`${portfolioSnapshots.takenAt} >= ${windowStart.toISOString()}::timestamptz`,
      );
    const existingHours = new Set(
      existing.map((row) => new Date(row.takenAt).setMinutes(0, 0, 0)),
    );

    // Hour-by-hour running capital: deposits - withdrawals + realized - fees.
    const hourlyNet = new Map<number, number>();
    for (const movement of movements) {
      const hourBucket = new Date(movement.createdAt).setMinutes(0, 0, 0);
      const amount = Number(movement.amount);
      const delta =
        movement.type === "deposit"
          ? amount
          : movement.type === "withdrawal"
            ? -amount
            : movement.type === "realized_pnl"
              ? amount
              : -amount; // fee
      hourlyNet.set(hourBucket, (hourlyNet.get(hourBucket) ?? 0) + delta);
    }

    // Capital before the window anchors the replay.
    const [pre] = await db
      .select({
        net: sql<string>`coalesce(sum(${sql.raw(
          "case when type = 'deposit' then amount when type = 'withdrawal' then -amount when type = 'realized_pnl' then amount else -amount end",
        )}), '0')`,
      })
      .from(capitalTransactions)
      .where(
        sql`${capitalTransactions.createdAt} < ${windowStart.toISOString()}::timestamptz`,
      );
    let running = Number(pre?.net ?? 0);

    const toInsert: CapitalAtPoint[] = [];
    const nowHour = new Date().setMinutes(0, 0, 0);
    for (let t = windowStart.getTime(); t < nowHour; t += 3_600_000) {
      const hourBucket = new Date(t).setMinutes(0, 0, 0);
      running += hourlyNet.get(hourBucket) ?? 0;
      if (existingHours.has(hourBucket)) {
        continue;
      }
      toInsert.push({
        accountId: "system",
        availableCapital: running.toString(),
        investedCapital: "0",
        takenAt: new Date(t),
        totalCapital: running.toString(),
      });
    }

    if (toInsert.length === 0) {
      return 0;
    }
    await db.insert(portfolioSnapshots).values(toInsert);
    log.info({
      backfilled: toInsert.length,
      job: "portfolio-snapshot-backfill",
    });
    return toInsert.length;
  } catch (error) {
    log.error(
      error instanceof Error
        ? error
        : new Error("portfolio snapshot backfill failed"),
    );
    return 0;
  }
}

export async function runPortfolioSnapshotJob(): Promise<void> {
  // The job runs on an interval (outside any request scope), so it uses the
  // global `log` API rather than the request-scoped getLogger().
  try {
    const { availableCapital, investedCapital, totalCapital } =
      await computeLedgerCapital();

    // Hour bucket: update-in-place keeps the rollup idempotent per hour.
    const hourStart = new Date();
    hourStart.setMinutes(0, 0, 0);

    const existing = await db
      .select({ id: portfolioSnapshots.id })
      .from(portfolioSnapshots)
      .where(
        sql`${portfolioSnapshots.takenAt} = ${hourStart.toISOString()}::timestamptz`,
      )
      .limit(1);

    if (existing.length > 0) {
      await db
        .update(portfolioSnapshots)
        .set({
          availableCapital: availableCapital.toString(),
          investedCapital: investedCapital.toString(),
          totalCapital: totalCapital.toString(),
        })
        .where(eq(portfolioSnapshots.id, existing[0].id));
      log.info({ job: "portfolio-snapshot", action: "updated", totalCapital });
      return;
    }

    await db.insert(portfolioSnapshots).values({
      accountId: "system",
      availableCapital: availableCapital.toString(),
      investedCapital: investedCapital.toString(),
      takenAt: hourStart,
      totalCapital: totalCapital.toString(),
    });
    log.info({ job: "portfolio-snapshot", action: "created", totalCapital });
  } catch (error) {
    // The job must never crash the process; the next interval retries.
    log.error(
      error instanceof Error
        ? error
        : new Error("portfolio snapshot job failed"),
    );
  }
}
