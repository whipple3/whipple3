import type { AgentId, NodeId, Principal, SessionId, TxId } from "./ids.js";
import type { Mutation } from "./mutation.js";

/**
 * Causality baked into every event: `causationId` chains double as cycle detection /
 * hop budgets (safety) and trace propagation (observability). (SPEC §4.5, §7)
 * `principal` is on-behalf-of attribution — "Michael's agent did", not just "auditor
 * did". Reserved now because it cannot be reconstructed from old logs later.
 */
export interface EventMeta {
  readonly txId: TxId;
  readonly sessionId: SessionId;
  readonly agentId: AgentId | null;
  readonly principal: Principal | null;
  readonly ts: number;
  readonly causationId: TxId | null;
  readonly correlationId: TxId;
}

/**
 * Full taxonomy reserved from day one so observability and evals are adapters later,
 * not a rewrite. v0.1 emits the subset it can observe. (SPEC §7)
 */
export type Whipple3Event =
  | { readonly type: "graph.mutation"; readonly mutation: Mutation }
  | {
      readonly type: "acl.denied";
      readonly agentId: AgentId;
      readonly label: string;
      readonly reason: "read" | "write";
    }
  | { readonly type: "claim.acquired"; readonly nodeId: NodeId; readonly agentId: AgentId }
  | { readonly type: "claim.released"; readonly nodeId: NodeId; readonly agentId: AgentId }
  | { readonly type: "claim.expired"; readonly nodeId: NodeId; readonly agentId: AgentId }
  | { readonly type: "agent.triggered"; readonly agentId: AgentId; readonly reason: string }
  | { readonly type: "agent.started"; readonly agentId: AgentId }
  | { readonly type: "agent.completed"; readonly agentId: AgentId }
  | { readonly type: "agent.failed"; readonly agentId: AgentId; readonly message: string }
  | {
      readonly type: "llm.call";
      readonly model: string;
      readonly inputTokens: number;
      readonly outputTokens: number;
      readonly costUsd: number | null;
      readonly latencyMs: number;
    }
  | { readonly type: "tool.call"; readonly name: string; readonly latencyMs: number }
  | { readonly type: "sandbox.spawned"; readonly image: string }
  | { readonly type: "sandbox.exited"; readonly exitCode: number }
  | { readonly type: "session.started"; readonly task: string }
  | { readonly type: "session.distilled"; readonly summary: string }
  | { readonly type: "session.purged" };

export interface LogRecord {
  readonly seq: number;
  readonly meta: EventMeta;
  readonly event: Whipple3Event;
}
