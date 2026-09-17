import { desc } from "drizzle-orm";

import { db } from "@/db";
import {
  strategies,
  strategyAssets,
  strategySignalSources,
} from "@/db/schema/strategies";
import { getLogger, withEvlog } from "@/lib/evlog";
import {
  type StrategiesResponse,
  type StrategyDto,
  type StrategyInput,
  strategyInputSchema,
} from "@/lib/queries/strategies";
import { requireWriteAccess } from "@/lib/route-auth";

export const dynamic = "force-dynamic";

/** Create the strategy row plus its normalized asset/source children. */
export async function insertStrategy(
  input: StrategyInput,
): Promise<StrategyDto> {
  const [row] = await db
    .insert(strategies)
    .values({
      active: input.active,
      entryThreshold: input.entryThreshold,
      exitThreshold: input.exitThreshold,
      llmProvider: input.llmProvider,
      maxPositionPct: input.maxPositionPct.toString(),
      name: input.name,
      stopLossPct: input.stopLossPct.toString(),
      type: input.type,
    })
    .returning();

  if (!row) {
    throw new Error("strategy insert returned no row");
  }

  if (input.assets.length > 0) {
    await db
      .insert(strategyAssets)
      .values(input.assets.map((asset) => ({ asset, strategyId: row.id })));
  }
  if (input.signalSources.length > 0) {
    await db
      .insert(strategySignalSources)
      .values(
        input.signalSources.map((source) => ({ source, strategyId: row.id })),
      );
  }

  return {
    active: row.active,
    assets: input.assets,
    createdAt: row.createdAt.toISOString(),
    entryThreshold: row.entryThreshold,
    exitThreshold: row.exitThreshold,
    id: row.id,
    llmProvider: row.llmProvider,
    maxPositionPct: Number(row.maxPositionPct),
    name: row.name,
    signalSources: input.signalSources,
    stopLossPct: Number(row.stopLossPct),
    type: row.type,
  };
}

/**
 * GET /api/strategies — all configured strategies, newest-first, with their
 * normalized assets and signal sources aggregated back into arrays.
 */
export const GET = withEvlog(async () => {
  const logger = getLogger();
  logger.set({ integration: "strategies" });

  try {
    const rows = await db
      .select()
      .from(strategies)
      .orderBy(desc(strategies.createdAt));
    const assetRows = await db
      .select({
        asset: strategyAssets.asset,
        strategyId: strategyAssets.strategyId,
      })
      .from(strategyAssets);
    const sourceRows = await db
      .select({
        source: strategySignalSources.source,
        strategyId: strategySignalSources.strategyId,
      })
      .from(strategySignalSources);

    const items: StrategyDto[] = rows.map((row) => ({
      active: row.active,
      assets: assetRows
        .filter((a) => a.strategyId === row.id)
        .map((a) => a.asset),
      createdAt: row.createdAt.toISOString(),
      entryThreshold: row.entryThreshold,
      exitThreshold: row.exitThreshold,
      id: row.id,
      llmProvider: row.llmProvider,
      maxPositionPct: Number(row.maxPositionPct),
      name: row.name,
      signalSources: sourceRows
        .filter((s) => s.strategyId === row.id)
        .map((s) => s.source),
      stopLossPct: Number(row.stopLossPct),
      type: row.type,
    }));

    return Response.json({ items } satisfies StrategiesResponse);
  } catch (error) {
    logger.set({
      error: `strategies unavailable: ${
        error instanceof Error ? error.message : "unknown"
      }`,
    });
    return Response.json({ error: "strategies unavailable" }, { status: 500 });
  }
});

/** POST /api/strategies — create a strategy with assets + signal sources. */
export const POST = withEvlog(async (request: Request) => {
  const logger = getLogger();
  logger.set({ integration: "strategies" });

  const auth = requireWriteAccess(request);
  if (!auth.ok) {
    return auth.response;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const parsed = strategyInputSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "invalid strategy payload", detail: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const strategy = await insertStrategy(parsed.data);
    return Response.json({ strategy }, { status: 201 });
  } catch (error) {
    logger.set({
      error: `strategy create failed: ${
        error instanceof Error ? error.message : "unknown"
      }`,
    });
    return Response.json({ error: "strategy create failed" }, { status: 500 });
  }
});
