"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { agentsDbQueries } from "@/lib/queries/agents-db";
import { consensusQueries } from "@/lib/queries/consensus";
import { feedQueries } from "@/lib/queries/events";
import { openPositionsQueries } from "@/lib/queries/positions";
import { quotesQueries } from "@/lib/queries/quotes";
import { signalActivityQueries } from "@/lib/queries/signals";
import { statusQueries } from "@/lib/queries/status";
import { strategyQueries } from "@/lib/queries/strategies";
import { registerWebMCPTools, type WebMCPTool } from "@/lib/webmcp";

// Mirrors the broker context's durable runtime-settings query so WebMCP
// reads reuse the same cache entry the UI polls.
function runtimeSettingsQuery() {
  return {
    queryKey: ["settings", "runtime"] as const,
    queryFn: async (): Promise<unknown> => {
      const res = await fetch("/api/settings/runtime");
      if (!res.ok) {
        throw new Error(`API ${res.status}: ${res.statusText}`);
      }
      return (await res.json()) as unknown;
    },
  };
}

/** Render a tool failure as a serializable message instead of throwing. */
function fail(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `data: {"error": ${JSON.stringify(message)}}`;
}

/**
 * Registers read-only terminal tools with WebMCP while the user is signed in.
 * Every tool is `readOnlyHint` and `untrustedContentHint` (external market /
 * agent data): agents may read the terminal, never mutate or execute trades.
 */
export function WebMCPTools() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const registry: WebMCPTool[] = [
      {
        name: "viipers_get_terminal_status",
        description:
          "Return the Viipers terminal portfolio summary: available, invested and total capital, open position count, daily/weekly/total P&L, broker state and live LLM token usage.",
        inputSchema: { type: "object", properties: {} },
        annotations: { readOnlyHint: true, untrustedContentHint: true },
        execute: async () => {
          try {
            const data = await queryClient.ensureQueryData(
              statusQueries.summary(),
            );
            return `data: ${JSON.stringify(data)}`;
          } catch (error) {
            return fail(error);
          }
        },
      },
      {
        name: "viipers_list_agents",
        description:
          "Return the agent swarm fleet: per-agent id, codename, model, role, team, health, runtime metrics and leaderboard stats (PNL, ROI, Sharpe, win rate, trades, score).",
        inputSchema: { type: "object", properties: {} },
        annotations: { readOnlyHint: true, untrustedContentHint: true },
        execute: async () => {
          try {
            const data = await queryClient.ensureQueryData(
              agentsDbQueries.fleet(),
            );
            return `data: ${JSON.stringify(data)}`;
          } catch (error) {
            return fail(error);
          }
        },
      },
      {
        name: "viipers_list_open_positions",
        description:
          "Return the terminal's currently open positions with asset, direction, entry/mark price, quantity and P&L.",
        inputSchema: { type: "object", properties: {} },
        annotations: { readOnlyHint: true, untrustedContentHint: true },
        execute: async () => {
          try {
            const data = await queryClient.ensureQueryData(
              openPositionsQueries.list(),
            );
            return `data: ${JSON.stringify(data)}`;
          } catch (error) {
            return fail(error);
          }
        },
      },
      {
        name: "viipers_list_strategies",
        description:
          "Return the trading strategy registry: entry/exit thresholds, position caps, stop-loss, signal sources, LLM provider and enabled state.",
        inputSchema: { type: "object", properties: {} },
        annotations: { readOnlyHint: true, untrustedContentHint: true },
        execute: async () => {
          try {
            const data = await queryClient.ensureQueryData(
              strategyQueries.list(),
            );
            return `data: ${JSON.stringify(data)}`;
          } catch (error) {
            return fail(error);
          }
        },
      },
      {
        name: "viipers_get_consensus_proposals",
        description:
          "Return the consensus pipeline's active proposals with asset, direction, confidence, votes for/against and deadline.",
        inputSchema: { type: "object", properties: {} },
        annotations: { readOnlyHint: true, untrustedContentHint: true },
        execute: async () => {
          try {
            const data = await queryClient.ensureQueryData(
              consensusQueries.list(),
            );
            return `data: ${JSON.stringify(data)}`;
          } catch (error) {
            return fail(error);
          }
        },
      },
      {
        name: "viipers_get_live_quotes",
        description:
          "Return live market ticker quotes (asset, price, 24h change, signal score) as cached by the terminal.",
        inputSchema: { type: "object", properties: {} },
        annotations: { readOnlyHint: true, untrustedContentHint: true },
        execute: async () => {
          try {
            const data = await queryClient.ensureQueryData(
              quotesQueries.live(),
            );
            return `data: ${JSON.stringify(data)}`;
          } catch (error) {
            return fail(error);
          }
        },
      },
      {
        name: "viipers_get_runtime_settings",
        description:
          "Return the server-enforced runtime settings: active broker, automation, consensus quorum, daily-loss cap, max open positions and rollback thresholds.",
        inputSchema: { type: "object", properties: {} },
        annotations: { readOnlyHint: true, untrustedContentHint: true },
        execute: async () => {
          try {
            const data = await queryClient.ensureQueryData(
              runtimeSettingsQuery(),
            );
            return `data: ${JSON.stringify(data)}`;
          } catch (error) {
            return fail(error);
          }
        },
      },
      {
        name: "viipers_get_recent_signals",
        description:
          "Return the most recent sentiment signals: asset, score, sentiment direction, source and source text snippet.",
        inputSchema: { type: "object", properties: {} },
        annotations: { readOnlyHint: true, untrustedContentHint: true },
        execute: async () => {
          try {
            const data = await queryClient.ensureQueryData(
              signalActivityQueries.recent(),
            );
            return `data: ${JSON.stringify(data)}`;
          } catch (error) {
            return fail(error);
          }
        },
      },
      {
        name: "viipers_get_signal_activity",
        description:
          "Return the 24h signal activity histogram: per-bucket signal volume and net bullish-minus-bearish direction.",
        inputSchema: { type: "object", properties: {} },
        annotations: { readOnlyHint: true, untrustedContentHint: true },
        execute: async () => {
          try {
            const data = await queryClient.ensureQueryData(
              signalActivityQueries.hourly(),
            );
            return `data: ${JSON.stringify(data)}`;
          } catch (error) {
            return fail(error);
          }
        },
      },
      {
        name: "viipers_get_recent_feed",
        description:
          "Return the terminal's recent event feed: consensus, trade, signal, alert and heartbeat events with timestamps.",
        inputSchema: { type: "object", properties: {} },
        annotations: { readOnlyHint: true, untrustedContentHint: true },
        execute: async () => {
          try {
            const data = await queryClient.ensureQueryData(
              feedQueries.recent(),
            );
            return `data: ${JSON.stringify(data)}`;
          } catch (error) {
            return fail(error);
          }
        },
      },
    ];

    const controller = new AbortController();
    void registerWebMCPTools(registry, { signal: controller.signal });
    return () => controller.abort();
  }, [queryClient]);

  return null;
}
