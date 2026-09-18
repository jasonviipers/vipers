import { and, count, eq, gte, sql } from "drizzle-orm";

import { brokerQuoteCurrency, isKnownBroker } from "@/channels/broker/registry";
import { db } from "@/db";
import { agents } from "@/db/schema/agent";
import { capitalTransactions, portfolioSnapshots } from "@/db/schema/portfolio";
import { positions } from "@/db/schema/trading";
import { getBrokerCredentials } from "@/lib/broker-credentials";
import { getLogger, withEvlog } from "@/lib/evlog";
import { llmUsageSummary } from "@/lib/llm-usage";
import { getRuntimeSettings } from "@/lib/runtime-settings";

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
  const logger = getLogger();
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

  // Mirrors the execution tool's routing rule: the ACTIVE broker with
  // stored credentials (UI-managed, encrypted) -> connected (demo flag
  // shown), otherwise the paper-book stub.
  let broker: {
    /** Account-equity currency for the active broker ("USDT" | "USD"). */
    currency: string;
    id: string;
    shortName: string;
    status: "connected" | "paper";
  } = {
    currency: "USDT",
    id: "okx",
    shortName: "PAPER BOOK",
    status: "paper",
  };
  try {
    const { activeBrokerId } = await getRuntimeSettings();
    const id = isKnownBroker(activeBrokerId) ? activeBrokerId : "okx";
    const stored = await getBrokerCredentials(id);
    if (stored) {
      broker = {
        currency: brokerQuoteCurrency(id),
        id,
        shortName:
          id === "alpaca"
            ? stored.mode === "live"
              ? "ALPACA"
              : "ALPACA PAPER"
            : stored.mode === "live"
              ? "OKX"
              : "OKX DEMO",
        status: "connected",
      };
    } else {
      broker = {
        currency: brokerQuoteCurrency(id),
        id,
        shortName: "PAPER BOOK",
        status: "paper",
      };
    }
  } catch {
    // DB hiccup: keep the paper-book default instead of failing the payload.
  }

  // --- LLM usage / cost ---------------------------------------------------
  let llm = {
    todayCost: 0,
    todayInputTokens: 0,
    todayOutputTokens: 0,
    totalCost: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
  };
  try {
    llm = await llmUsageSummary();
  } catch (error) {
    logger.set({
      warning: `llm usage unavailable: ${
        error instanceof Error ? error.message : "unknown"
      }`,
    });
  }

  return Response.json({
    agents: { online: agentOnline, total: agentTotal },
    broker,
    llm,
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
