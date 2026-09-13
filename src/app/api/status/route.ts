import { and, count, eq, gte, sql } from "drizzle-orm";

import { db } from "@/db";
import { agents } from "@/db/schema/agent";
import { capitalTransactions, portfolioSnapshots } from "@/db/schema/portfolio";
import { positions } from "@/db/schema/trading";
import { env } from "@/env";
import { useLogger, withEvlog } from "@/lib/evlog";

export const dynamic = "force-dynamic";

function startOfLocalDay(daysAgo = 0): Date {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  now.setDate(now.getDate() - daysAgo);
  return now;
}

/**
 * GET /api/status — terminal-wide status payload.
 *
 * Consumed by the StatusBar (footer) and the dashboard PortfolioSummary;
 * both subscribe to the same TanStack query key so the request is shared.
 *
 * Each source degrades independently: a DB hiccup zeroes that block
 * instead of failing the whole payload.
 */
export const GET = withEvlog(async () => {
  const logger = useLogger();
  logger.set({ integration: "status" });

  let agentTotal = 0;
  let agentOnline = 0;
  try {
    const [total] = await db.select({ value: count() }).from(agents);
    const [online] = await db
      .select({ value: count() })
      .from(agents)
      .where(eq(agents.status, "online"));
    agentTotal = total?.value ?? 0;
    agentOnline = online?.value ?? 0;
  } catch (error) {
    logger.set({
      warning: `agent counts unavailable: ${
        error instanceof Error ? error.message : "unknown"
      }`,
    });
  }

  // --- Portfolio -----------------------------------------------------------
  // totalPnl:   open positions (unrealized, cached by the price-tick job)
  // totalCapital / availableCapital: latest portfolio snapshot rollup
  // dailyPnl / weeklyPnl: realized ledger movements in the window
  //   (deposits/withdrawals are capital flows, not P&L, so they're excluded)
  let totalPnl = 0;
  let openPositionsCount = 0;
  let totalCapital = 0;
  let availableCapital = 0;
  let investedCapital = 0;
  let dailyPnl = 0;
  let weeklyPnl = 0;
  let equityHistory: { takenAt: string; totalCapital: number }[] = [];

  try {
    const [openPnl] = await db
      .select({
        pnl: sql<string>`coalesce(sum(${positions.pnl}), '0')`,
        positionsCount: count(),
      })
      .from(positions)
      .where(eq(positions.status, "OPEN"));
    totalPnl = Number(openPnl?.pnl ?? 0);
    openPositionsCount = openPnl?.positionsCount ?? 0;

    const [snapshot] = await db
      .select()
      .from(portfolioSnapshots)
      .orderBy(sql`${portfolioSnapshots.takenAt} desc`)
      .limit(1);
    totalCapital = Number(snapshot?.totalCapital ?? 0);
    availableCapital = Number(snapshot?.availableCapital ?? 0);
    investedCapital = Number(snapshot?.investedCapital ?? 0);

    // Oldest-first history for the dashboard equity curve (bounded to the
    // most recent 60 rollups).
    const history = await db
      .select({
        takenAt: portfolioSnapshots.takenAt,
        totalCapital: portfolioSnapshots.totalCapital,
      })
      .from(portfolioSnapshots)
      .orderBy(sql`${portfolioSnapshots.takenAt} desc`)
      .limit(60);
    equityHistory = history
      .map((h) => ({
        takenAt: h.takenAt.toISOString(),
        totalCapital: Number(h.totalCapital),
      }))
      .reverse();

    const realizedFilter = (from: Date) =>
      and(
        gte(capitalTransactions.createdAt, from),
        sql`${capitalTransactions.type} in ('realized_pnl', 'fee')`,
      );
    const [daily] = await db
      .select({
        pnl: sql<string>`coalesce(sum(${capitalTransactions.amount}), '0')`,
      })
      .from(capitalTransactions)
      .where(realizedFilter(startOfLocalDay(0)));
    const [weekly] = await db
      .select({
        pnl: sql<string>`coalesce(sum(${capitalTransactions.amount}), '0')`,
      })
      .from(capitalTransactions)
      .where(realizedFilter(startOfLocalDay(7)));
    dailyPnl = Number(daily?.pnl ?? 0);
    weeklyPnl = Number(weekly?.pnl ?? 0);
  } catch (error) {
    logger.set({
      warning: `portfolio metrics unavailable: ${
        error instanceof Error ? error.message : "unknown"
      }`,
    });
  }

  // Mirrors the execution tool's routing rule: OKX credentials present ->
  // live broker (demo flag shown), otherwise the paper-book stub.
  const okxConfigured = Boolean(
    env.OKX_API_KEY && env.OKX_SECRET && env.OKX_PASSPHRASE,
  );
  const broker = okxConfigured
    ? {
        shortName: env.OKX_DEMO === "true" ? "OKX DEMO" : "OKX",
        status: "connected" as const,
      }
    : { shortName: "PAPER BOOK", status: "paper" as const };

  return Response.json({
    agents: { online: agentOnline, total: agentTotal },
    broker,
    portfolio: {
      availableCapital,
      dailyPnl,
      equityHistory,
      investedCapital,
      openPositionsCount,
      totalCapital,
      totalPnl,
      totalPnlPct: investedCapital > 0 ? (totalPnl / investedCapital) * 100 : 0,
      weeklyPnl,
    },
  });
});
