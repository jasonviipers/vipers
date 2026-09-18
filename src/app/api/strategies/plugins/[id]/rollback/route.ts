import { z } from "zod";

import {
  type DisableReason,
  disableStrategyPlugin,
} from "@/ai/capital-engine/strategy-lifecycle";
import { getLogger, withEvlog } from "@/lib/evlog";
import { requirePermission } from "@/lib/session-auth";

export const dynamic = "force-dynamic";

const rollbackSchema = z.object({
  detail: z.string().max(200).optional(),
  reason: z.enum(["operator", "regulatory", "risk-breach"]),
});

const REASON_STATUS: Record<string, number> = {
  "already-disabled": 200,
  "gate-error": 500,
  "plugin-not-found": 404,
};

/**
 * POST /api/strategies/plugins/[id]/rollback — the MANUAL rollback command
 * (checklist §7): an explicit operator halt of a strategy plugin at ANY
 * stage, recorded in append-only lineage as HALTED.
 *
 * This is the operator-facing half of "automatic rollback triggers and a
 * manual rollback command". The automatic half is the strategy-rollback
 * monitor (src/lib/jobs/strategy-rollback-job.ts), which calls the same
 * disableStrategyPlugin kill switch with reason "risk-breach"; the manual
 * surface exists so a human can act faster than the monitor's next pass —
 * including on evidence the metrics cannot see (news, venue behavior,
 * plain unease).
 *
 * Deliberate differences from .../disable: no `fixture-drift` reason
 * (drift refuses disablement-by-claim — re-disable with a true reason; the
 * fixture verifier runs at reactivate), and no `under-review` (roll back
 * decisively; reactivation returns the plugin to DRAFT either way).
 * Re-disabling an already-disabled plugin is idempotent 200: the goal
 * state is achieved either way. Both routes are audited identically.
 */
export const POST = withEvlog(
  async (request: Request, ctx: { params: Promise<{ id: string }> }) => {
    const logger = getLogger();
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

    const parsed = rollbackSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        {
          detail: parsed.error.flatten(),
          error: "expected { reason, detail? }",
        },
        { status: 400 },
      );
    }

    const outcome = await disableStrategyPlugin({
      operator: auth.identity.subject,
      pluginId: id,
      reason: parsed.data.reason as DisableReason,
      reasonDetail: parsed.data.detail,
    });

    if (!outcome.ok) {
      const status = REASON_STATUS[outcome.reason] ?? 500;
      logger.set({ rollbackRefused: outcome.reason });
      return Response.json(
        {
          error: `rollback refused: ${outcome.reason}`,
          reason: outcome.reason,
        },
        { status },
      );
    }

    logger.set({
      audit: "strategy_rollback",
      pluginId: id,
      previousStage: outcome.stage,
      reason: parsed.data.reason,
    });
    return Response.json({
      haltedRecord: outcome.record,
      previousStage: outcome.stage,
      rolledBack: true,
    });
  },
);
