/** The only public gate of @arai/core. No deep imports. (SPEC §5) */

export type { AclError, AclPolicy } from "./acl.js";
export { checkAcl } from "./acl.js";
export type { AraiEvent, EventMeta, LogRecord } from "./events.js";
export type { AgentId, Brand, EdgeId, NodeId, SessionId, TxId, Version } from "./ids.js";
export {
  agentId,
  bump,
  edgeId,
  INITIAL_VERSION,
  nodeId,
  sessionId,
  txId,
  version,
} from "./ids.js";
export type { Mutation, MutationError } from "./mutation.js";
export { apply, replay } from "./mutation.js";
export type { Err, Ok, Result } from "./result.js";
export { err, isErr, isOk, map, ok, unwrapOr } from "./result.js";
export type { EdgeType, NodeType, Trigger } from "./schema.js";
export { defineEdge, defineNode } from "./schema.js";

export type { Slice } from "./slice.js";
export { availableWork, neighborhood } from "./slice.js";
export type { ClaimRecord, EdgeRecord, GraphState, NodeRecord } from "./state.js";
export { emptyState } from "./state.js";
