/**
 * Authentication identities: WHAT the request claims to be.
 *
 * This module only answers "who is calling" — subject, kind, and for agents
 * which fleet member. It never decides "what may they do": that is the
 * permission layer's job (src/lib/permissions.ts).
 *
 * Three identity kinds exist:
 *  - `operator`  — an operator API key (API_KEY_VALID). Full terminal owner.
 *  - `demo`      — the read-only demo key.
 *  - `agent`     — a fleet member. Each agent gets its own stable identity
 *                  derived from its config (src/ai/agents/config.ts), so
 *                  multi-agent activity stays attributable per agent.
 */

import { timingSafeEqual } from "node:crypto";
import type { AgentConfig } from "@/ai/agents/config";
import { agentConfigs } from "@/ai/agents/config";
import { env } from "@/env";
import {
  can,
  DEMO_PERMISSIONS,
  OPERATOR_PERMISSIONS,
  type Permission,
  type PermissionSet,
  permissionsForAgent,
} from "@/lib/permissions";

export type IdentityKind = "operator" | "demo" | "agent";

/** What kind of identity a submitted API key resolves to. */
export type ApiKeyClassification = "valid" | "demo" | "invalid" | "agent";

/**
 * A resolved identity. For agents, `subject` is the agent's stable id and
 * `permissions` is derived from its grants — the permission layer's decision,
 * carried here only so route handlers don't re-look it up.
 */
export interface Identity {
  /** Stable subject, e.g. "operator", "demo", or "agent:sentiment-agent". */
  subject: string;
  kind: IdentityKind;
  /** Fleet agent id; present when kind === "agent". */
  agentId?: string;
  /** Agent display/codename context (mirrors config). */
  agent?: { id: string; codename?: string; team?: string };
  demo: boolean;
  permissions: PermissionSet;
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) {
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

/** Shape check for a well-formed operator-style API key. */
export function isWellFormedApiKey(key: string): boolean {
  return new RegExp(env.API_KEY_PATTERN).test(key);
}

function operatorIdentity(): Identity {
  return {
    subject: "operator",
    kind: "operator",
    demo: false,
    permissions: OPERATOR_PERMISSIONS,
  };
}

function demoIdentity(): Identity {
  return {
    subject: "demo",
    kind: "demo",
    demo: true,
    permissions: DEMO_PERMISSIONS,
  };
}

export function agentIdentity(agentId: string): Identity | null {
  const config = agentConfigs.find((agent) => agent.id === agentId);
  if (!config) {
    return null;
  }
  return agentIdentityFromConfig(config);
}

export function agentIdentityFromConfig(config: AgentConfig): Identity {
  return {
    subject: `agent:${config.id}`,
    kind: "agent",
    agentId: config.id,
    agent: {
      id: config.id,
      codename: config.codename,
      team: config.team,
    },
    demo: false,
    permissions: permissionsForAgent(config.id),
  };
}

/** All fleet agent identities, keyed by agent id. */
export const agentIdentities: ReadonlyMap<string, Identity> = new Map(
  agentConfigs.map((config) => [config.id, agentIdentityFromConfig(config)]),
);

/** The subject an identity resolves to (used for logging, read-state). */
export function identitySubject(identity: Identity): string {
  return identity.subject;
}

/**
 * Classify a raw API key. Deliberately constant-time against the operator
 * and demo keys so a timing oracle can't leak their bytes.
 */
export function classifyApiKey(key: string): ApiKeyClassification {
  if (typeof key !== "string" || key.length === 0 || !isWellFormedApiKey(key)) {
    return "invalid";
  }
  if (safeEqual(key, env.API_KEY_VALID)) {
    return "valid";
  }
  if (safeEqual(key, env.DEMO_API_KEY)) {
    return "demo";
  }
  // Agent keys are optional; when configured they give each fleet member a
  // dedicated credential of its own (`api/agents/db/[id]/run`).
  for (const agentKey of Object.values(parseAgentApiKeys())) {
    if (safeEqual(key, agentKey)) {
      return "agent";
    }
  }
  return "invalid";
}

/**
 * Resolve a raw API key to a full identity, or null when it is not any known
 * key. Returns the agent identity for a configured per-agent key.
 */
export function resolveApiKey(key: string): Identity | null {
  const classification = classifyApiKey(key);
  if (classification === "valid") {
    return operatorIdentity();
  }
  if (classification === "demo") {
    return demoIdentity();
  }
  if (classification === "agent") {
    for (const [agentId, agentKey] of Object.entries(parseAgentApiKeys())) {
      if (safeEqual(key, agentKey)) {
        return agentIdentity(agentId);
      }
    }
  }
  return null;
}

/**
 * Optional per-agent API keys, `{"<agent-id>": "vps_...", ...}` parsed from
 * AGENT_API_KEYS. Absent → each agent still has its OWN identity, it just
 * authenticates via the operator key (headless agent HTTP access isn't
 * enabled) while in-process runs are attributed to the agent identity.
 */
function parseAgentApiKeys(): Record<string, string> {
  const raw = env.AGENT_API_KEYS?.trim();
  if (!raw) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed === "object" && parsed !== null) {
      const out: Record<string, string> = {};
      for (const [agentId, key] of Object.entries(parsed)) {
        if (typeof key === "string" && key.trim()) {
          out[agentId] = key;
        }
      }
      return out;
    }
  } catch {
    // Malformed config — treat as unset rather than crashing the app.
  }
  return {};
}

/** Convenience for callers that only need a single permission check. */
export function identityCan(
  identity: Identity,
  permission: Permission,
): boolean {
  return can(identity.permissions, permission);
}
