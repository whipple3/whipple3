import type { AgentId, NodeId } from "./ids.js";
import type { Mutation } from "./mutation.js";
import { err, ok, type Result } from "./result.js";
import type { GraphState } from "./state.js";

/** What one agent may do, by node/edge label. Absent agent = may do nothing. (SPEC §4.6) */
export interface AgentAcl {
  readonly write: readonly string[];
  readonly read: readonly string[];
}

/** agentId -> its allowed labels, both directions. Enforced by the engine on every access. */
export type AclPolicy = Readonly<Record<string, AgentAcl>>;

/**
 * Denials NAME the label, deliberately — in the acl.denied audit event and in the error
 * the agent receives (the read path pins this in tests). Labels are shared schema
 * vocabulary, not secrets; what the ACL protects is nodes' existence-in-slices and
 * props, which a denial never carries. Auditability outranks hiding a label name.
 */
export interface AclError {
  readonly code: "ACL_DENIED_WRITE" | "ACL_DENIED_READ";
  readonly agentId: AgentId;
  readonly label: string;
}

const labelOf = (m: Mutation, state: GraphState): string | null => {
  switch (m.kind) {
    case "ADD_NODE":
      return m.label;
    case "ADD_EDGE":
      return m.label;
    case "UPDATE_NODE":
    case "CLAIM_NODE":
    case "RELEASE_NODE": {
      const id: NodeId = m.id;
      return state.nodes.get(id)?.label ?? null;
    }
  }
};

export const checkAcl = (
  policy: AclPolicy,
  agent: AgentId,
  m: Mutation,
  state: GraphState,
): Result<null, AclError> => {
  const label = labelOf(m, state);
  if (label === null) return ok(null); // existence errors are apply()'s job, not ACL's
  if (policy[agent]?.write.includes(label) === true) return ok(null);
  return err({ code: "ACL_DENIED_WRITE", agentId: agent, label });
};

export const checkRead = (
  policy: AclPolicy,
  agent: AgentId,
  label: string,
): Result<null, AclError> => {
  if (policy[agent]?.read.includes(label) === true) return ok(null);
  return err({ code: "ACL_DENIED_READ", agentId: agent, label });
};

/** The reader's allowed labels, for slice filtering. Policy shape knowledge stays here. */
export const readableLabels = (policy: AclPolicy, agent: AgentId): readonly string[] =>
  policy[agent]?.read ?? [];
