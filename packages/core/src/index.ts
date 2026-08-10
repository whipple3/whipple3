/** The only public gate of @whipple3/core. No deep imports. (SPEC §5) */

export type { AclError, AclPolicy, AgentAcl } from "./acl.js";
export { checkAcl, checkRead, readableLabels } from "./acl.js";
export type { EventMeta, LogRecord, Whipple3Event } from "./events.js";
export type { AgentId, Brand, EdgeId, NodeId, Principal, SessionId, TxId, Version } from "./ids.js";
export {
  agentId,
  bump,
  edgeId,
  INITIAL_VERSION,
  nodeId,
  principal,
  sessionId,
  txId,
  version,
} from "./ids.js";
export type { Mutation, MutationError } from "./mutation.js";
export { apply, replay } from "./mutation.js";
export type { Err, Ok, Result } from "./result.js";
export { err, isErr, isOk, map, ok, unwrapOr } from "./result.js";
export type { EdgeType, FollowRule, NodeType, SliceDecl, Trigger } from "./schema.js";
export { defineEdge, defineNode, defineSlice, follow } from "./schema.js";

export type { Slice } from "./slice.js";
export { availableWork, neighborhood, readableNeighborhood, sliceFor } from "./slice.js";
export type { ClaimRecord, EdgeRecord, GraphState, NodeRecord } from "./state.js";
export { emptyState } from "./state.js";
