import { z } from "zod";
import { promotePlugin } from "@/ai/capital-engine/promote-plugin";
import {
  PROMOTION_STAGES,
  type PromotionRecord,
} from "@/ai/capital-engine/promotion";
import { getLogger, withEvlog } from "@/lib/evlog";
import { requirePermission } from "@/lib/session-auth";

export const dynamic = "force-dynamic";

const promoteSchema = z.object({
  record: z.object({
    configHash: z.string().min(1),
    // Shape only: whether the evidence set is SUFFICIENT (non-empty, real
    // snapshot ids) is the promotion gate's call, surfaced as 409
    // incomplete-record, not a 400 payload error here.
    dataSnapshotIds: z.array(z.string().min(1)),
    evaluatedAt: z.string().min(1),
    pluginId: z.string().min(1),
    pluginVersion: z.string().min(1),
    policyHash: z.string().min(1),
    stage: z.enum(PROMOTION_STAGES),
  }),
  toStage: z.enum(PROMOTION_STAGES),
});

/** HTTP status for each typed gate refusal. */
const REASON_STATUS: Record<string, number> = {
  "gate-error": 500,
  "incomplete-record": 409,
  "invalid-manifest": 400,
  "invalid-transition": 409,
  "no-lineage": 409,
  "not-loaded": 409,
  "plugin-not-found": 404,
  "stale-head": 409,
};

/**
 * POST /api/strategies/plugins/[id]/promote — advance a strategy plugin's
 * promotion stage (operator action).
 *
 * The request body supplies only the evaluation evidence and the target
 * stage; plugin identity is resolved from the URL against the DB, lineage
 * is read server-side, and the advance runs through `advancePromotionGate`
 * (fixtures re-verified in the isolated runtime, record must be the current
 * lineage head, immutable transition policy enforced). A 409 with
 * `reason: "stale-head"` means the operator's view of lineage was outdated:
 * re-GET and resubmit.
 */
export const POST = withEvlog(
  async (request: Request, ctx: { params: Promise<{ id: string }> }) => {
    const logger = getLogger();
    logger.set({ integration: "strategies" });

    // Stage advancement changes capital risk posture — strategy managers
    // only (demo sessions are read-only by construction).
    const auth = requirePermission(request, "strategies:manage");
    if (!auth.ok) {
      return auth.response;
    }
    logger.set({
      caller: { kind: auth.identity.kind, subject: auth.identity.subject },
    });

    const { id } = await ctx.params;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "invalid JSON body" }, { status: 400 });
    }

    const parsed = promoteSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        {
          detail: parsed.error.flatten(),
          error:
            "expected { record: PromotionRecord, toStage: PROMOTION_STAGES }",
        },
        { status: 400 },
      );
    }

    const { record, toStage } = parsed.data;
    // The record's pluginId must agree with the URL identity; the gate
    // treats disagreement as the tamper it is.
    if (record.pluginId !== id) {
      return Response.json(
        { error: "record.pluginId does not match the URL plugin id" },
        { status: 400 },
      );
    }

    const outcome = await promotePlugin({
      pluginId: id,
      record: record as PromotionRecord,
      toStage,
    });

    if (!outcome.ok) {
      const status = REASON_STATUS[outcome.reason] ?? 500;
      logger.set({ promoteReason: outcome.reason });
      return Response.json(
        {
          error: `promotion refused: ${outcome.reason}`,
          reason: outcome.reason,
        },
        { status },
      );
    }

    logger.set({
      advancedTo: outcome.result.advanced.stage,
      pluginId: id,
    });
    return Response.json({
      advanced: outcome.result.advanced,
      verifiedManifest: outcome.result.manifest,
    });
  },
);
