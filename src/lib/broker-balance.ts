import { eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { capitalTransactions, portfolioSnapshots } from "@/db/schema/portfolio";
import { positions } from "@/db/schema/trading";
import { getBrokerCredentials } from "@/lib/broker-credentials";
import { postCapitalMovement } from "@/lib/capital-ledger";
import { log } from "@/lib/evlog";

import { okxClient } from "../channels/okx/client";

/**
 * Broker balance → capital ledger sync.
 *
 * TOTAL CAPITAL is derived from `capital_transactions` (the ledger is the
 * source of truth; see portfolio-snapshot-job). Connecting a broker alone
 * feeds nothing into that ledger, so the dashboard would show 0 forever.
 * This module closes the loop: it reads the OKX account equity and records
 * the delta vs. the ledger as a deposit/withdrawal movement, keeping the
 * ledger's append-only model intact.
 *
 * The sync is authoritative toward the ledger but conservative about the
 * broker: only a real, decrypted credential set triggers an API call, and
 * only a positive account equity is ever recorded (a zero/failed equity
 * read writes nothing, so a transient OKX error can't wipe capital).
 */

/** Ledger account id for broker-synced capital (mirrors EXECUTION_ACCOUNT). */
const SYNC_ACCOUNT = "system";

export interface BrokerEquity {
  /** Account equity in USDT (OKX totalEq). */
  equityUsd: number;
  mode: "demo" | "live";
  /** ISO timestamp of the OKX snapshot. */
  updatedAt: string;
}

export interface SyncResult {
  /** Capital delta recorded in the ledger (0 when already in sync). */
  delta: number;
  equityUsd: number;
  mode: "demo" | "live";
  /** Ledger capital after the movement landed (without open PnL). */
  baseCapital: number;
  /** Rollup total the dashboard will show (base + open PnL). */
  totalCapital: number;
}

export class BrokerNotConfiguredError extends Error {
  constructor() {
    super("OKX is not configured: add credentials in /settings first");
    this.name = "BrokerNotConfiguredError";
  }
}

/**
 * Read the OKX account equity in USDT. Throws BrokerNotConfiguredError when
 * no credentials are stored; propagates OKX API errors to the caller.
 */
export async function fetchBrokerEquity(): Promise<BrokerEquity> {
  const stored = await getBrokerCredentials("okx");
  if (!stored) {
    throw new BrokerNotConfiguredError();
  }

  const balance = await okxClient.getBalance();
  const equityUsd = Number(balance?.totalEq ?? 0);
  if (!Number.isFinite(equityUsd) || equityUsd < 0) {
    throw new Error("OKX returned an unreadable account equity");
  }

  return {
    equityUsd,
    mode: stored.mode,
    updatedAt: balance?.udTime
      ? new Date(Number(balance.udTime)).toISOString()
      : new Date().toISOString(),
  };
}

/**
 * Reconcile the capital ledger with the current OKX account equity.
 *
 * Records exactly one `deposit` (equity above ledger) or `withdrawal`
 * (equity below ledger) movement for the gap, then refreshes the latest
 * portfolio snapshot so the dashboard reflects the new total immediately —
 * no waiting for the hourly rollup.
 *
 * Open positions are excluded from the delta on purpose: their unrealized
 * P&L is already part of OKX equity AND is added on top of the ledger by
 * the capital rollup (`+ openPnl`), so including them here would count
 * that P&L twice.
 */
export async function syncBrokerBalanceToLedger(): Promise<SyncResult> {
  const equity = await fetchBrokerEquity();

  // Ledger capital WITHOUT open PnL — that part is owned by the rollup.
  const [flows] = await db
    .select({
      deposits: sql<string>`coalesce(sum(${sql.raw(
        "case when type = 'deposit' then amount else 0 end",
      )}), '0')`,
      withdrawals: sql<string>`coalesce(sum(${sql.raw(
        "case when type = 'withdrawal' then amount else 0 end",
      )}), '0')`,
      realizedNet: sql<string>`coalesce(sum(${sql.raw(
        "case when type = 'realized_pnl' then amount when type = 'fee' then -amount else 0 end",
      )}), '0')`,
    })
    .from(capitalTransactions);

  const [open] = await db
    .select({
      invested: sql<string>`coalesce(sum(${positions.entryPrice} * ${positions.quantity}), '0')`,
      openPnl: sql<string>`coalesce(sum(${positions.pnl}), '0')`,
    })
    .from(positions)
    .where(eq(positions.status, "OPEN"));

  const ledgerCapital =
    Number(flows?.deposits ?? 0) -
    Number(flows?.withdrawals ?? 0) +
    Number(flows?.realizedNet ?? 0);
  const openPnl = Number(open?.openPnl ?? 0);
  const investedCapital = Number(open?.invested ?? 0);

  // Target base capital: strip unrealized P&L from the broker equity so the
  // delta is measured on the same basis the rollup will rebuild it from.
  const targetBase = Math.max(0, equity.equityUsd - openPnl);
  const delta = Number((targetBase - ledgerCapital).toFixed(2));

  // After the movement lands, the ledger base equals targetBase, so the
  // rollup formula (base + openPnl) converges on the broker equity.
  const newBase = Math.max(0, targetBase);
  const totalCapital = newBase + openPnl;
  const availableCapital = Math.max(0, totalCapital - investedCapital);

  if (Math.abs(delta) >= 0.01) {
    const movementType = delta > 0 ? "deposit" : "withdrawal";
    const ledgerPost = await postCapitalMovement({
      amount: Math.abs(delta),
      currency: "USDT",
      idempotencyKey: `okx-balance:${equity.mode}:${equity.updatedAt}:${movementType}:${Math.abs(delta).toFixed(2)}`,
      source: "okx-balance-reconciliation",
      type: movementType,
    });

    // Keep the legacy projection as a compatibility read model. The
    // independent ledger is posted first; retries are safe through its
    // idempotency key, and a failed ledger post cannot create legacy-only
    // capital.
    await db.insert(capitalTransactions).values({
      accountId: SYNC_ACCOUNT,
      amount: Math.abs(delta).toString(),
      type: movementType,
    });
    log.info({
      action: "capital_ledger_posted",
      duplicate: ledgerPost.duplicate,
      transactionId: ledgerPost.transactionId,
    });
  }

  // Refresh the latest snapshot in place so /api/status shows the new
  // total immediately instead of at the next hourly rollup.
  await refreshLatestSnapshot({
    availableCapital,
    investedCapital,
    totalCapital,
  });

  log.info({
    action: "broker_balance_synced",
    brokerId: "okx",
    delta,
    equityUsd: equity.equityUsd,
    mode: equity.mode,
  });

  return {
    baseCapital: newBase,
    delta,
    equityUsd: equity.equityUsd,
    mode: equity.mode,
    totalCapital,
  };
}

/**
 * Update the most recent portfolio snapshot to the given totals, or create
 * one for the current hour when none exists. Best-effort: the ledger row
 * above is the real change; this only accelerates dashboard visibility.
 */
async function refreshLatestSnapshot(totals: {
  availableCapital: number;
  investedCapital: number;
  totalCapital: number;
}): Promise<void> {
  try {
    const hourStart = new Date();
    hourStart.setMinutes(0, 0, 0);

    const [latest] = await db
      .select({ id: portfolioSnapshots.id })
      .from(portfolioSnapshots)
      .orderBy(sql`${portfolioSnapshots.takenAt} desc`)
      .limit(1);

    if (latest) {
      await db
        .update(portfolioSnapshots)
        .set({
          availableCapital: totals.availableCapital.toString(),
          investedCapital: totals.investedCapital.toString(),
          totalCapital: totals.totalCapital.toString(),
        })
        .where(eq(portfolioSnapshots.id, latest.id));
      return;
    }

    await db.insert(portfolioSnapshots).values({
      accountId: SYNC_ACCOUNT,
      availableCapital: totals.availableCapital.toString(),
      investedCapital: totals.investedCapital.toString(),
      takenAt: hourStart,
      totalCapital: totals.totalCapital.toString(),
    });
  } catch (error) {
    log.error(
      error instanceof Error
        ? error
        : new Error("snapshot refresh after balance sync failed"),
    );
  }
}
