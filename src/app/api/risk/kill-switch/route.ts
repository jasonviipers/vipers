import { eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { riskControls } from "@/db/schema/risk";
import { useLogger, withEvlog } from "@/lib/evlog";
import { requireWriteAccess } from "@/lib/route-auth";

export const dynamic = "force-dynamic";

const killSwitchSchema = z.object({ enabled: z.boolean() });

/**
 * GET /api/risk/kill-switch — current server-owned kill-switch state.
 * Read endpoint (the settings UI needs the state on load); no secrets.
 */
export const GET = withEvlog(async () => {
  const logger = useLogger();
  logger.set({ integration: "risk" });

  const [row] = await db
    .select({ enabled: riskControls.killSwitchEnabled })
    .from(riskControls)
    .where(eq(riskControls.id, "global"));

  return Response.json({ enabled: row?.enabled ?? false });
});

/**
 * POST /api/risk/kill-switch — arm/disarm the server-owned kill switch.
 *
 * Write-access only (demo key → 403). The consensus workflow's risk gate
 * reads this state before every approval, so arming it halts all new
 * order submission server-side regardless of which client armed it.
 */
export const POST = withEvlog(async (request: Request) => {
  const logger = useLogger();
  logger.set({ integration: "risk" });

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

  const parsed = killSwitchSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      {
        error: "expected { enabled: boolean }",
        detail: parsed.error.flatten(),
      },
      { status: 400 },
    );
  }

  // Upsert the singleton row (id = "global").
  const [row] = await db
    .insert(riskControls)
    .values({
      id: "global",
      killSwitchEnabled: parsed.data.enabled,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      set: {
        killSwitchEnabled: parsed.data.enabled,
        updatedAt: new Date(),
      },
      target: riskControls.id,
    })
    .returning();

  logger.set({
    audit: "kill_switch",
    enabled: row?.killSwitchEnabled ?? false,
  });
  return Response.json({ enabled: row?.killSwitchEnabled ?? false });
});
