/**
 * Authorization: WHAT an authenticated identity may do.
 *
 * Deliberately separate from authentication (src/lib/identity.ts). A request
 * first proves WHO it is (a signed session cookie, or an API key); only then
 * do these grants decide what that identity may touch. Keeping the two apart
 * is what makes the fleet flexible: an agent key and the operator key both
 * authenticate, but the agent only carries the permissions its role grants.
 *
 * The core trading invariant is preserved here: the ONLY identity that may
 * submit to the broker is `order-executor-agent`, and the deterministic risk
 * engine is never bypassable through a permission grant (`risk:control` lets
 * an operator flip the kill switch, it does not let an agent around the gate).
 */

export type Permission =
  /** Read terminal data (signals, positions, quotes, status, …). */
  | "read"
  /** Personalize per-identity state (notification read-state, settings). */
  | "personalize"
  /** Trigger an agent execution (spends LLM calls). */
  | "run:agent"
  /** Trigger background jobs (portfolio snapshot, leaderboard score). */
  | "jobs:run"
  /** Manage encrypted broker / LLM credentials. */
  | "credentials:manage"
  /** Change risk controls (kill switch). */
  | "risk:control"
  /** Change server-owned runtime settings. */
  | "settings:manage"
  /** Create / update / delete strategies and their lifecycle. */
  | "strategies:manage"
  /** Take part in consensus decisions. */
  | "consensus:decide"
  /** Submit / reconcile broker orders. Solely order-executor-agent. */
  | "execution:submit";

export type PermissionSet = ReadonlySet<Permission>;

const ALL_PERMISSIONS: readonly Permission[] = [
  "read",
  "personalize",
  "run:agent",
  "jobs:run",
  "credentials:manage",
  "risk:control",
  "settings:manage",
  "strategies:manage",
  "consensus:decide",
  "execution:submit",
];

const setFrom = (perms: readonly Permission[]): PermissionSet =>
  new Set<Permission>(perms);

/** The operator's full grant — every capability the terminal exposes. */
export const OPERATOR_PERMISSIONS: PermissionSet = setFrom(ALL_PERMISSIONS);

/**
 * Demo sessions prove WHO they are (they authenticate) but are read-only by
 * design: they may look at derived data and personalize their own read-state,
 * never mutate state, spend LLM calls, or touch credentials.
 */
export const DEMO_PERMISSIONS: PermissionSet = setFrom(["read", "personalize"]);

/**
 * Baseline grant for a fleet agent. Agents may read market data and be run
 * explicitly; anything beyond that is granted per agent in AGENT_PERMISSIONS.
 */
export const AGENT_BASE_PERMISSIONS: PermissionSet = setFrom([
  "read",
  "run:agent",
]);

/**
 * Per-agent grants keyed by agent id. Only capabilities each role genuinely
 * needs; the execution agent is the single holder of `execution:submit`.
 */
export const AGENT_PERMISSIONS: Readonly<Record<string, Permission[]>> = {
  // Collects sentiment from social/news sources — nothing more.
  "sentiment-agent": [],
  // Reads charts and indicators.
  "technical-analysis-agent": [],
  // Produces trade PROPOSALS. It may reason and propose, but has no
  // permission to touch risk controls or execute anything.
  "reasoning-analysis-agent": [],
  // The mandatory validation gate. It evaluates risk; it does not trade
  // and must never hold a grant that could route itself around the gate.
  "risk-agent": [],
  // THE only identity allowed to place orders with the broker.
  "order-executor-agent": ["execution:submit"],
  // Aggregates proposals into consensus decisions.
  "orchestrator-agent": ["consensus:decide"],
};

/**
 * Resolve the permission set for an agent id. Unknown agents fall back to
 * the base grant so a typo'd id never accidentally widens access.
 */
export function permissionsForAgent(agentId: string): PermissionSet {
  const extras = AGENT_PERMISSIONS[agentId] ?? [];
  return setFrom(["read", "run:agent", ...extras]);
}

/** True when an identity's grant contains the requested permission. */
export function can(
  permissions: PermissionSet,
  permission: Permission,
): boolean {
  return permissions.has(permission);
}
