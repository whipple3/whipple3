import type { AgentId, NodeId } from "./ids.js";
import type { Mutation } from "./mutation.js";
import { err, ok, type Result } from "./result.js";
import type { GraphState } from "./state.js";

/** agentId -> node labels it may create/mutate. Enforced by the engine on every mutation. (SPEC §4.6) */
export type AclPolicy = Readonly<Record<string, readonly string[]>>;

export interface AclError {
  readonly code: "ACL_DENIED";
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
  if (policy[agent as string]?.includes(label) === true) return ok(null);
  return err({ code: "ACL_DENIED", agentId: agent, label });
};
