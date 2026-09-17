import { desc, eq } from "drizzle-orm";

import { db } from "@/db";
import { agents } from "@/db/schema/agent";
import { marketPrices, positions } from "@/db/schema/trading";
import { getLogger, withEvlog } from "@/lib/evlog";
import type { OpenPosition } from "@/lib/queries/positions";

export const dynamic = "force-dynamic";

const LIMIT = 50;

/**
 * GET /api/positions/open — OPEN positions for the dashboard's
 * PositionsTable, newest-first, joined with agent display names.
 *
 * currentPrice comes from the `market_prices` cache table (refreshed by the
 * price-tick job); positions whose asset has no cached tick yet return
 * `currentPrice: null` and the UI falls back to the entry price. pnl /
 * pnlPct are the position row's cached values — never recomputed client-side.
 */
export const GET = withEvlog(async () => {
  const logger = getLogger();
  logger.set({ integration: "positions" });

  try {
    const rows = await db
      .select({
        agentId: positions.agentId,
        agentName: agents.name,
        asset: positions.asset,
        direction: positions.direction,
        entryPrice: positions.entryPrice,
        id: positions.id,
        openedAt: positions.openedAt,
        pnl: positions.pnl,
        pnlPct: positions.pnlPct,
        quantity: positions.quantity,
      })
      .from(positions)
      .leftJoin(agents, eq(positions.agentId, agents.id))
      .where(eq(positions.status, "OPEN"))
      .orderBy(desc(positions.openedAt))
      .limit(LIMIT);

    const priceRows = await db
      .select({ asset: marketPrices.asset, price: marketPrices.price })
      .from(marketPrices);
    const priceByAsset = new Map(
      priceRows.map((p) => [p.asset, Number(p.price)]),
    );

    const items: OpenPosition[] = rows.map((row) => {
      const currentPrice = priceByAsset.get(row.asset) ?? null;
      return {
        agentName: row.agentName ?? row.agentId,
        asset: row.asset,
        currentPrice,
        direction: row.direction,
        entryPrice: Number(row.entryPrice),
        id: row.id,
        openedAt: row.openedAt.toISOString(),
        pnl: Number(row.pnl),
        pnlPct: Number(row.pnlPct),
        quantity: Number(row.quantity),
      };
    });

    return Response.json({ items });
  } catch (error) {
    logger.set({
      error: `open positions unavailable: ${
        error instanceof Error ? error.message : "unknown"
      }`,
    });
    return Response.json(
      { error: "open positions unavailable" },
      { status: 500 },
    );
  }
});
