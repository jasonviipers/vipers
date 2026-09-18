import { z } from "zod";

const riskVerdictSchema = z.object({
  code: z.enum(["APPROVED", "REJECTED", "EXPIRED", "UNAVAILABLE"]),
  reason: z.string().min(1),
  evaluatedAt: z.string().datetime(),
  policyVersion: z.string().min(1),
});

export type RiskVerdict = z.infer<typeof riskVerdictSchema>;

export function createRiskVerdict(input: {
  code: RiskVerdict["code"];
  policyVersion: string;
  reason: string;
  evaluatedAt?: string;
}): RiskVerdict {
  return riskVerdictSchema.parse({
    code: input.code,
    evaluatedAt: input.evaluatedAt ?? new Date().toISOString(),
    policyVersion: input.policyVersion,
    reason: input.reason,
  });
}

export function riskVerdictFromEvaluation(input: {
  approved: boolean;
  reason: string;
  policyVersion?: string;
}): RiskVerdict {
  return createRiskVerdict({
    code: input.approved ? "APPROVED" : "REJECTED",
    policyVersion: input.policyVersion ?? "risk-v1",
    reason: input.reason,
  });
}
