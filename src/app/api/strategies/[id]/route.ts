import { eq } from "drizzle-orm";

import { db } from "@/db";
import {
  strategies,
  strategyAssets,
  strategySignalSources,
} from "@/db/schema/strategies";
import { useLogger, withEvlog } from "@/lib/evlog";
import {
  type StrategyDto,
  type StrategyInput,
  strategyInputSchema,
} from "@/lib/queries/strategies";
import { requireWriteAccess } from "@/lib/route-auth";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * PATCH accepts a partial payload so the UI can toggle `active` without
 * resending the whole strategy; children are only replaced when their
 * fields are present in the patch.
 */
const strategyPatchSchema = strategyInputSchema.partial();

/**
 * PATCH /api/strategies/[id] — full update of a strategy, replacing its
 * normalized asset/signal-source children in one transaction. 404 on an
 * unknown id, 400 on validation failure.
 */
export const PATCH = withEvlog(async (request: Request, ctx: Params) => {
  const logger = useLogger();
  logger.set({ integration: "strategies" });

  const auth = requireWriteAccess(request);
  if (!auth.ok) {
    return auth.response;
  }

  const { id } = await ctx.params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const parsed = strategyPatchSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "invalid strategy payload", detail: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const patch: Partial<StrategyInput> = parsed.data;

  try {
    const strategy = await db.transaction(
      async (tx): Promise<StrategyDto | null> => {
        const [row] = await tx
          .update(strategies)
          .set({
            ...(patch.active !== undefined ? { active: patch.active } : {}),
            ...(patch.entryThreshold !== undefined
              ? { entryThreshold: patch.entryThreshold }
              : {}),
            ...(patch.exitThreshold !== undefined
              ? { exitThreshold: patch.exitThreshold }
              : {}),
            ...(patch.llmProvider !== undefined
              ? { llmProvider: patch.llmProvider }
              : {}),
            ...(patch.maxPositionPct !== undefined
              ? { maxPositionPct: patch.maxPositionPct.toString() }
              : {}),
            ...(patch.name !== undefined ? { name: patch.name } : {}),
            ...(patch.stopLossPct !== undefined
              ? { stopLossPct: patch.stopLossPct.toString() }
              : {}),
            ...(patch.type !== undefined ? { type: patch.type } : {}),
          })
          .where(eq(strategies.id, id))
          .returning();

        if (!row) {
          return null;
        }

        if (patch.assets) {
          // Children are small and fully replaced — delete + reinsert keeps
          // this idempotent without diffing.
          await tx
            .delete(strategyAssets)
            .where(eq(strategyAssets.strategyId, id));
          await tx
            .insert(strategyAssets)
            .values(patch.assets.map((asset) => ({ asset, strategyId: id })));
        }
        if (patch.signalSources) {
          await tx
            .delete(strategySignalSources)
            .where(eq(strategySignalSources.strategyId, id));
          await tx.insert(strategySignalSources).values(
            patch.signalSources.map((source) => ({
              source,
              strategyId: id,
            })),
          );
        }

        // Echo the stored row (numeric fields come back as strings); the
        // client refetches the list for authoritative children anyway.
        return {
          active: row.active,
          assets: patch.assets ?? [],
          createdAt: row.createdAt.toISOString(),
          entryThreshold: row.entryThreshold,
          exitThreshold: row.exitThreshold,
          id: row.id,
          llmProvider: row.llmProvider,
          maxPositionPct: Number(row.maxPositionPct),
          name: row.name,
          signalSources: patch.signalSources ?? [],
          stopLossPct: Number(row.stopLossPct),
          type: row.type,
        };
      },
    );

    if (!strategy) {
      return Response.json({ error: "strategy not found" }, { status: 404 });
    }

    return Response.json({ strategy });
  } catch (error) {
    logger.set({
      error: `strategy update failed: ${
        error instanceof Error ? error.message : "unknown"
      }`,
    });
    return Response.json({ error: "strategy update failed" }, { status: 500 });
  }
});

/**
 * DELETE /api/strategies/[id] — removes the strategy and its normalized
 * children. Child-first deletion avoids FK violations on databases without
 * ON DELETE CASCADE.
 */
export const DELETE = withEvlog(async (request: Request, ctx: Params) => {
  const logger = useLogger();
  logger.set({ integration: "strategies" });

  const auth = requireWriteAccess(request);
  if (!auth.ok) {
    return auth.response;
  }

  const { id } = await ctx.params;

  try {
    const deleted = await db.transaction(async (tx) => {
      await tx.delete(strategyAssets).where(eq(strategyAssets.strategyId, id));
      await tx
        .delete(strategySignalSources)
        .where(eq(strategySignalSources.strategyId, id));
      const rows = await tx
        .delete(strategies)
        .where(eq(strategies.id, id))
        .returning({ id: strategies.id });
      return rows[0];
    });

    if (!deleted) {
      return Response.json({ error: "strategy not found" }, { status: 404 });
    }

    return Response.json({ ok: true });
  } catch (error) {
    logger.set({
      error: `strategy delete failed: ${
        error instanceof Error ? error.message : "unknown"
      }`,
    });
    return Response.json({ error: "strategy delete failed" }, { status: 500 });
  }
});
