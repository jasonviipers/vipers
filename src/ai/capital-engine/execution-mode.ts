export type CredentialMode = "demo" | "live";
export type ExecutionRoute = "paper" | "live" | "blocked";

export function resolveExecutionRoute(input: {
  credentialMode: CredentialMode | null;
  nodeEnvironment: "development" | "test" | "production";
}): ExecutionRoute {
  if (input.credentialMode === "live") {
    return "live";
  }
  if (input.credentialMode === "demo") {
    return "paper";
  }
  return input.nodeEnvironment === "production" ? "blocked" : "paper";
}

export function assertExecutionRoute(
  requested: ExecutionRoute,
  actual: ExecutionRoute,
): void {
  if (requested === "blocked" || actual === "blocked") {
    throw new Error(
      "Execution route is blocked until broker mode is configured",
    );
  }
  if (requested !== actual) {
    throw new Error(
      `Execution mode mismatch: requested ${requested}, configured ${actual}`,
    );
  }
}
