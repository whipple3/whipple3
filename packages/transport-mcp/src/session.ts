import {
  type AclError,
  type AclPolicy,
  type AgentId,
  agentId,
  apply,
  availableWork,
  checkAcl,
  type EventMeta,
  edgeId,
  emptyState,
  err,
  type GraphState,
  type Mutation,
  type MutationError,
  type NodeRecord,
  neighborhood,
  nodeId,
  ok,
  type Result,
  type SessionId,
  type Slice,
  type TxId,
  type Version,
  version,
} from "@arai/core";
import type { LogStore } from "@arai/log";
import type { z } from "zod";
import { toolInputs } from "./tools.js";

export interface ParseError {
  readonly code: "PARSE_ERROR";
  readonly issues: readonly { readonly path: string; readonly message: string }[];
}

export type SessionError = ParseError | AclError | MutationError;

export interface SessionDeps {
  readonly log: LogStore;
  /** null = no ACL configured: the host's tool allowlist is the only gate. (SPEC §4.6) */
  readonly acl: AclPolicy | null;
  readonly sessionId: SessionId;
  readonly now: () => number;
  readonly newTxId: () => TxId;
}

const parseWith = <T>(schema: z.ZodType<T>, input: unknown): Result<T, ParseError> => {
  const r = schema.safeParse(input);
  if (r.success) return ok(r.data);
  return err({
    code: "PARSE_ERROR",
    issues: r.error.issues.map((i) => ({ path: i.path.map(String).join("."), message: i.message })),
  });
};

type PostedMutation = z.output<(typeof toolInputs)["blackboard_post"]>["mutation"];

const brandMutation = (m: PostedMutation): Mutation => {
  switch (m.kind) {
    case "ADD_NODE":
      return { kind: "ADD_NODE", id: nodeId(m.id), label: m.label, props: m.props };
    case "UPDATE_NODE":
      return {
        kind: "UPDATE_NODE",
        id: nodeId(m.id),
        expectedVersion: version(m.expectedVersion),
        props: m.props,
      };
    case "ADD_EDGE":
      return {
        kind: "ADD_EDGE",
        id: edgeId(m.id),
        label: m.label,
        from: nodeId(m.from),
        to: nodeId(m.to),
      };
  }
};

export interface SessionStatus {
  readonly nodes: number;
  readonly edges: number;
  readonly activeClaims: number;
  readonly byLabel: Readonly<Record<string, number>>;
}

export const createSession = (deps: SessionDeps) => {
  let state: GraphState = emptyState();
  // One trace per session; causation chains arrive with push dispatch (Phase 2, SPEC §4.5).
  const correlationId = deps.newTxId();

  const meta = (agent: AgentId, tx: TxId): EventMeta => ({
    txId: tx,
    sessionId: deps.sessionId,
    agentId: agent,
    ts: deps.now(),
    causationId: null,
    correlationId,
  });

  const commit = async (agent: AgentId, m: Mutation): Promise<Result<TxId, SessionError>> => {
    if (deps.acl !== null) {
      const gate = checkAcl(deps.acl, agent, m, state);
      if (!gate.ok) return gate;
    }
    const applied = apply(state, m);
    if (!applied.ok) return applied;
    state = applied.value;
    const tx = deps.newTxId();
    await deps.log.append(meta(agent, tx), { type: "graph.mutation", mutation: m });
    return ok(tx);
  };

  return {
    async post(
      input: unknown,
    ): Promise<Result<{ txId: TxId; version: Version | null }, SessionError>> {
      const parsed = parseWith(toolInputs.blackboard_post, input);
      if (!parsed.ok) return parsed;
      const m = brandMutation(parsed.value.mutation);
      const committed = await commit(agentId(parsed.value.agentId), m);
      if (!committed.ok) return committed;
      const touched = m.kind === "ADD_EDGE" ? null : (state.nodes.get(m.id)?.version ?? null);
      return ok({ txId: committed.value, version: touched });
    },

    async claim(input: unknown): Promise<Result<{ txId: TxId; expiresAt: number }, SessionError>> {
      const parsed = parseWith(toolInputs.blackboard_claim, input);
      if (!parsed.ok) return parsed;
      const at = deps.now();
      const committed = await commit(agentId(parsed.value.agentId), {
        kind: "CLAIM_NODE",
        id: nodeId(parsed.value.id),
        agentId: agentId(parsed.value.agentId),
        now: at,
        ttlMs: parsed.value.ttlMs,
      });
      if (!committed.ok) return committed;
      return ok({ txId: committed.value, expiresAt: at + parsed.value.ttlMs });
    },

    next(input: unknown): Result<{ node: NodeRecord | null; pending: number }, ParseError> {
      const parsed = parseWith(toolInputs.blackboard_next, input);
      if (!parsed.ok) return parsed;
      const found = availableWork(
        state,
        { label: parsed.value.label, match: parsed.value.match },
        deps.now(),
      );
      return ok({ node: found[0] ?? null, pending: found.length });
    },

    read(input: unknown): Result<Slice, ParseError> {
      const parsed = parseWith(toolInputs.blackboard_read, input);
      if (!parsed.ok) return parsed;
      return ok(neighborhood(state, nodeId(parsed.value.root), parsed.value.depth));
    },

    status(): SessionStatus {
      const at = deps.now();
      const byLabel: Record<string, number> = {};
      for (const n of state.nodes.values()) byLabel[n.label] = (byLabel[n.label] ?? 0) + 1;
      let activeClaims = 0;
      for (const c of state.claims.values()) if (c.expiresAt > at) activeClaims += 1;
      return { nodes: state.nodes.size, edges: state.edges.size, activeClaims, byLabel };
    },

    snapshot: (): GraphState => state,
  };
};

export type Session = ReturnType<typeof createSession>;
