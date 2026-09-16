import { eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { runtimeSettings } from "@/db/schema/trading";

/**
 * Server-owned operator settings that the pipeline and API routes enforce.
 *
 * The /settings sliders for consensus quorum, daily-loss cap, max open
 * positions and debug mode write here (via PUT /api/settings/runtime) and
 * the ENFORCERS read from here:
 *
 *   automationEnabled     → automation tick gate     (automation job)
 *   automationIntervalSec → automation pass cadence  (automation job)
 *   consensusQuorum       → consensus step threshold (workflow)
 *   maxDailyLossPct       → risk gate daily-loss cap (risk gate)
 *   maxOpenPositions      → risk gate open-positions cap (risk gate)
 *   debugMode             → events feed detail level (events route)
 *
 * Display-only preferences (timezone, animations, notifications, etc.)
 * remain client-side in terminal-settings.
 */

export interface RuntimeSettings {
  automationEnabled: boolean;
  /** Seconds between automatic full-pipeline passes (bounded 60–3600). */
  automationIntervalSec: number;
  consensusQuorum: number;
  debugMode: boolean;
  /** Seconds; drives the agent online-window (interval × 3, bounded). */
  heartbeatInterval: number;
  maxDailyLossPct: number;
  maxOpenPositions: number;
  /** Default LLM provider for the agent fleet (validated upstream). */
  defaultLlmProvider: string;
}

export const RUNTIME_SETTINGS_DEFAULTS: RuntimeSettings = {
  automationEnabled: false,
  automationIntervalSec: 300,
  consensusQuorum: 50,
  debugMode: false,
  defaultLlmProvider: "GOOGLE",
  heartbeatInterval: 30,
  maxDailyLossPct: 3,
  maxOpenPositions: 10,
};

export const runtimeSettingsSchema = z.object({
  automationEnabled: z.boolean().optional(),
  automationIntervalSec: z.number().int().min(60).max(3600).optional(),
  consensusQuorum: z.number().int().min(30).max(100).optional(),
  debugMode: z.boolean().optional(),
  defaultLlmProvider: z
    .enum(["OPENAI", "ANTHROPIC", "GOOGLE", "XAI", "DEEPSEEK"])
    .optional(),
  heartbeatInterval: z.number().int().min(5).max(120).optional(),
  maxDailyLossPct: z.number().int().min(1).max(20).optional(),
  maxOpenPositions: z.number().int().min(1).max(50).optional(),
});

/** Fetch the singleton row, creating it with defaults on first access. */
export async function getRuntimeSettings(): Promise<RuntimeSettings> {
  const [row] = await db
    .select()
    .from(runtimeSettings)
    .where(eq(runtimeSettings.id, "global"))
    .limit(1);

  if (row) {
    return {
      automationEnabled:
        row.automationEnabled ?? RUNTIME_SETTINGS_DEFAULTS.automationEnabled,
      automationIntervalSec:
        row.automationIntervalSec ??
        RUNTIME_SETTINGS_DEFAULTS.automationIntervalSec,
      consensusQuorum:
        row.consensusQuorum ?? RUNTIME_SETTINGS_DEFAULTS.consensusQuorum,
      debugMode: row.debugMode,
      defaultLlmProvider:
        row.defaultLlmProvider ?? RUNTIME_SETTINGS_DEFAULTS.defaultLlmProvider,
      heartbeatInterval:
        row.heartbeatInterval ?? RUNTIME_SETTINGS_DEFAULTS.heartbeatInterval,
      maxDailyLossPct:
        row.maxDailyLossPct ?? RUNTIME_SETTINGS_DEFAULTS.maxDailyLossPct,
      maxOpenPositions:
        row.maxOpenPositions ?? RUNTIME_SETTINGS_DEFAULTS.maxOpenPositions,
    };
  }

  // First access (or a manually-cleared row): create the singleton.
  try {
    await db
      .insert(runtimeSettings)
      .values({ id: "global" })
      .onConflictDoNothing({ target: runtimeSettings.id });
  } catch {
    // A concurrent writer may have inserted first — either way the row
    // exists now; fall through to defaults.
  }
  return RUNTIME_SETTINGS_DEFAULTS;
}

/** Apply a validated partial patch and return the effective settings. */
export async function updateRuntimeSettings(
  patch: Partial<RuntimeSettings>,
): Promise<RuntimeSettings> {
  const current = await getRuntimeSettings();
  const next: RuntimeSettings = { ...current, ...patch };

  await db
    .insert(runtimeSettings)
    .values({
      automationEnabled: next.automationEnabled,
      automationIntervalSec: next.automationIntervalSec,
      consensusQuorum: next.consensusQuorum,
      debugMode: next.debugMode,
      defaultLlmProvider: next.defaultLlmProvider,
      heartbeatInterval: next.heartbeatInterval,
      id: "global",
      maxDailyLossPct: next.maxDailyLossPct,
      maxOpenPositions: next.maxOpenPositions,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: runtimeSettings.id,
      set: {
        automationEnabled: next.automationEnabled,
        automationIntervalSec: next.automationIntervalSec,
        consensusQuorum: next.consensusQuorum,
        debugMode: next.debugMode,
        defaultLlmProvider: next.defaultLlmProvider,
        heartbeatInterval: next.heartbeatInterval,
        maxDailyLossPct: next.maxDailyLossPct,
        maxOpenPositions: next.maxOpenPositions,
        updatedAt: new Date(),
      },
    });

  return next;
}
