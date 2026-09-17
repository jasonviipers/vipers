import { desc, eq } from "drizzle-orm";

import { db } from "@/db";
import { agents } from "@/db/schema/agent";
import { positions } from "@/db/schema/trading";
import { getLogger, withEvlog } from "@/lib/evlog";
import type { ClosedPosition } from "@/lib/queries/positions";

export const dynamic = "force-dynamic";

const LIMIT = 100;

/**
 * GET /api/positions/closed — CLOSED position history, most-recently-closed
 * first, joined with agent display names.
 *
 * There is no exitPrice column: the exit mark is derived from the cached pnl
 * frozen into the row at close time (LONG: entry + pnl/qty, SHORT inverse).
 * Rows with zero quantity (shouldn't exist, but guard anyway) report null.
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
        closedAt: positions.closedAt,
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
      .where(eq(positions.status, "CLOSED"))
      .orderBy(desc(positions.closedAt))
      .limit(LIMIT);

    const items: ClosedPosition[] = rows.map((row) => {
      const entryPrice = Number(row.entryPrice);
      const pnl = Number(row.pnl);
      const quantity = Number(row.quantity);
      const exitPrice =
        quantity !== 0
          ? entryPrice + (pnl / quantity) * (row.direction === "LONG" ? 1 : -1)
          : null;
      return {
        agentName: row.agentName ?? row.agentId,
        asset: row.asset,
        closedAt: (row.closedAt ?? row.openedAt).toISOString(),
        direction: row.direction,
        entryPrice,
        exitPrice,
        id: row.id,
        openedAt: row.openedAt.toISOString(),
        pnl,
        pnlPct: Number(row.pnlPct),
        quantity,
      };
    });

    return Response.json({ items });
  } catch (error) {
    logger.set({
      error: `closed positions unavailable: ${
        error instanceof Error ? error.message : "unknown"
      }`,
    });
    return Response.json(
      { error: "closed positions unavailable" },
      { status: 500 },
    );
  }
});
