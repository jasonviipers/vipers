import { anthropic } from "@ai-sdk/anthropic";
import { google } from "@ai-sdk/google";
import { openai } from "@ai-sdk/openai";
import type { ToolSet } from "ai";

/**
 * Native web search is provider-executed, so it can't live in a static
 * tools array like scrapeNews/scrapeReddit — it has to match whichever
 * provider resolveActiveModelInfo() resolved to for THIS call.
 *
 * The `as ToolSet` casts below are a known AI SDK typing gap, not a
 * runtime issue: ToolSet's inputSchema is typed FlexibleSchema<never>,
 * while each provider tool factory infers its own concrete schema type,
 * and TS's variance rules reject that even though the shapes are
 * compatible at runtime. Same class of error, same workaround, tracked
 * upstream at https://github.com/vercel/ai/issues/10697 and
 * https://github.com/vercel/ai/issues/11240.
 *
 * `provider` must match the id strings @/lib/llm-model actually returns —
 * confirm the exact values there before relying on this switch.
 */
export function resolveSearchTool(provider: string): ToolSet {
  switch (provider) {
    case "google":
      return { web_search: google.tools.googleSearch({}) } as ToolSet;
    case "anthropic":
      return {
        web_search: anthropic.tools.webSearch_20250305({ maxUses: 5 }),
      } as ToolSet;
    case "openai":
      return { web_search: openai.tools.webSearch() } as ToolSet;
    default:
      return {};
  }
}
