import { z } from "zod";

const tradeProposalSchema = z.object({
  confidence: z.number().finite().min(0).max(1),
  direction: z.enum(["LONG", "SHORT", "ABSTAIN"]),
  reasoning: z.string().trim().min(1).max(4_000),
});

export type TradeProposal = z.infer<typeof tradeProposalSchema>;

/**
 * Treat model output as untrusted input. Only a complete, schema-valid
 * LONG/SHORT proposals can progress to consensus; ABSTAIN is returned as an
 * explicit NO_TRADE decision for durable audit, while malformed JSON,
 * coercible strings, and incomplete objects result in no proposal.
 */
export function parseTradeProposal(
  text: string | undefined,
): TradeProposal | null {
  if (!text) {
    return null;
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, "").trim());
  } catch {
    return null;
  }

  const parsed = tradeProposalSchema.safeParse(decoded);
  return parsed.success ? parsed.data : null;
}
