import { reactivateStrategyPlugin } from "@/ai/capital-engine/strategy-lifecycle";
import { getLogger, withEvlog } from "@/lib/evlog";
import { requirePermission } from "@/lib/session-auth";

export const dynamic = "force-dynamic";

const REASON_STATUS: Record<string, number> = {
  "fixtures-drifted": 409,
  "gate-error": 500,
  "not-disabled": 409,
  "plugin-not-found": 404,
};

/**
 * POST /api/strategies/plugins/[id]/reactivate — bring a disabled plugin
 * back (operator action).
 *
 * Reactivation is REFUSED while the plugin's deterministic fixtures no
 * longer reproduce their recorded behavior in the isolated runtime (409
 * fixtures-drifted): a plugin that has drifted must be re-registered as a
 * new version, not waved back into the pipeline. On success the plugin is
 * re-enabled at DRAFT; promotion stages are re-earned through the normal
 * promotion gate, never restored automatically.
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

    const outcome = await reactivateStrategyPlugin({
      operator: auth.identity.subject,
      pluginId: id,
    });

    if (!outcome.ok) {
      const status = REASON_STATUS[outcome.reason] ?? 500;
      logger.set({ reactivateReason: outcome.reason });
      return Response.json(
        {
          error: `reactivation refused: ${outcome.reason}`,
          reason: outcome.reason,
        },
        { status },
      );
    }

    logger.set({ audit: "strategy_reactivate", pluginId: id });
    return Response.json({
      previousHead: outcome.record,
      reactivated: true,
      stage: outcome.stage,
    });
  },
);
