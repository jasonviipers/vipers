import { z } from "zod";

import {
  type DisableReason,
  disableStrategyPlugin,
} from "@/ai/capital-engine/strategy-lifecycle";
import { useLogger, withEvlog } from "@/lib/evlog";
import { requirePermission } from "@/lib/session-auth";

export const dynamic = "force-dynamic";

const disableSchema = z.object({
  reason: z.enum(["operator", "risk-breach", "fixture-drift", "under-review"]),
  reasonDetail: z.string().max(200).optional(),
});

const REASON_STATUS: Record<string, number> = {
  "already-disabled": 200,
  "gate-error": 500,
  "plugin-not-found": 404,
};

/**
 * POST /api/strategies/plugins/[id]/disable — halt a strategy plugin
 * (operator action, the explicit disable/rollback control).
 *
 * The plugin's enabled flag is cleared BEFORE the audit record is written,
 * and the consensus workflow checks the flag before every run — so a
 * disabled plugin stops deciding even if the audit write fails. Disabling
 * an already-disabled plugin succeeds idempotently (200) rather than
 * erroring: the operator's goal state is achieved either way.
 */
export const POST = withEvlog(
  async (request: Request, ctx: { params: Promise<{ id: string }> }) => {
    const logger = useLogger();
    logger.set({ integration: "strategies" });

    const auth = requirePermission(request, "strategies:manage");
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

    const parsed = disableSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        {
          detail: parsed.error.flatten(),
          error: "expected { reason, reasonDetail? }",
        },
        { status: 400 },
      );
    }

    const outcome = await disableStrategyPlugin({
      operator: auth.identity.subject,
      pluginId: id,
      reason: parsed.data.reason as DisableReason,
      reasonDetail: parsed.data.reasonDetail,
    });

    if (!outcome.ok) {
      const status = REASON_STATUS[outcome.reason] ?? 500;
      logger.set({ disableReason: outcome.reason });
      return Response.json(
        { error: `disable refused: ${outcome.reason}`, reason: outcome.reason },
        { status },
      );
    }

    logger.set({
      audit: "strategy_disable",
      pluginId: id,
      previousStage: outcome.stage,
      reason: parsed.data.reason,
    });
    return Response.json({
      disabled: true,
      haltedRecord: outcome.record,
      previousStage: outcome.stage,
    });
  },
);
