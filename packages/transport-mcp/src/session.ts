import {
  type AclError,
  type AclPolicy,
  type AgentId,
  apply,
  availableWork,
  checkAcl,
  checkRead,
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
  type Principal,
  type Result,
  readableLabels,
  readableNeighborhood,
  type SessionId,
  type Slice,
  type TxId,
  type Version,
  version,
} from "@whipple3/core";
import type { LogStore } from "@whipple3/log";
import type { z } from "zod";
import { toolInputs } from "./tools.js";

export interface ParseError {
  readonly code: "PARSE_ERROR";
  readonly issues: readonly { readonly path: string; readonly message: string }[];
}

export type SessionError = ParseError | AclError | MutationError;

/**
 * Board lifetime is a PARAMETER, never an assumption: nothing may hardcode
 * "session end ⇒ purge". Purge (Stage 2) is an explicit action gated by this policy —
 * not a side effect of a session ending, and never core's business. "persistent"
 * (multi-process boards) is reserved: the type admits it so persistence lands as
 * config, not refactor; the runtime rejects it until it exists. (SPEC §4.8)
 */
export type BoardLifetime = "ephemeral" | "persistent";

export interface SessionDeps {
  readonly log: LogStore;
  /** null = no ACL configured: the host's tool allowlist is the only gate. (SPEC §4.6) */
  readonly acl: AclPolicy | null;
  readonly sessionId: SessionId;
  /** On whose behalf this session runs. Injected: local env in OSS, SSO in enterprise. */
  readonly principal: Principal | null;
  /** Defaults to "ephemeral" — the only implemented mode in v0.1. */
  readonly lifetime?: BoardLifetime;
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
  if ((deps.lifetime ?? "ephemeral") === "persistent")
    throw new Error(
      "board lifetime 'persistent' is not implemented — only 'ephemeral' boards exist in v0.1 " +
        "(the parameter is reserved so persistence arrives as config, not refactor; ROADMAP Stage 5+)",
    );
  let state: GraphState = emptyState();
  // One trace per session; causation chains arrive with push dispatch (Phase 2, SPEC §4.5).
  const correlationId = deps.newTxId();

  const meta = (agent: AgentId, tx: TxId): EventMeta => ({
    txId: tx,
    sessionId: deps.sessionId,
    agentId: agent,
    principal: deps.principal,
    ts: deps.now(),
    causationId: null,
    correlationId,
  });

  /** Denials are audit events, never silent drops. (SPEC §4.6) */
  const deny = async (agent: AgentId, e: AclError): Promise<Result<never, AclError>> => {
    await deps.log.append(meta(agent, deps.newTxId()), {
      type: "acl.denied",
      agentId: agent as string,
      label: e.label,
      reason: e.code === "ACL_DENIED_READ" ? "read" : "write",
    });
    return err(e);
  };

  const commit = async (
    agent: AgentId,
    m: Mutation,
  ): Promise<Result<{ tx: TxId; version: Version | null }, SessionError>> => {
    if (deps.acl !== null) {
      const gate = checkAcl(deps.acl, agent, m, state);
      if (!gate.ok) return deny(agent, gate.error);
    }
    const applied = apply(state, m);
    if (!applied.ok) return applied;
    state = applied.value;
    // Captured BEFORE the append await: a concurrent commit may interleave there, and
    // the caller must be echoed the version ITS write produced. (found by W1-A)
    const touched =
      m.kind === "ADD_NODE" || m.kind === "UPDATE_NODE"
        ? (state.nodes.get(m.id)?.version ?? null)
        : null;
    const tx = deps.newTxId();
    await deps.log.append(meta(agent, tx), { type: "graph.mutation", mutation: m });
    return ok({ tx, version: touched });
  };

  /**
   * Identity enters here, once per connection — payloads cannot assert or override it.
   * stdio: one process per connection (the transport passes its bound agent);
   * UDS (Phase 2): one socket per agent, same principle. (SPEC §4.6)
   */
  const connect = (agent: AgentId) => ({
    async post(
      input: unknown,
    ): Promise<Result<{ txId: TxId; version: Version | null }, SessionError>> {
      const parsed = parseWith(toolInputs.blackboard_post, input);
      if (!parsed.ok) return parsed;
      const m = brandMutation(parsed.value.mutation);
      const committed = await commit(agent, m);
      if (!committed.ok) return committed;
      return ok({ txId: committed.value.tx, version: committed.value.version });
    },

    async claim(input: unknown): Promise<Result<{ txId: TxId; expiresAt: number }, SessionError>> {
      const parsed = parseWith(toolInputs.blackboard_claim, input);
      if (!parsed.ok) return parsed;
      const at = deps.now();
      const committed = await commit(agent, {
        kind: "CLAIM_NODE",
        id: nodeId(parsed.value.id),
        agentId: agent,
        now: at,
        ttlMs: parsed.value.ttlMs,
      });
      if (!committed.ok) return committed;
      return ok({ txId: committed.value.tx, expiresAt: at + parsed.value.ttlMs });
    },

    async next(
      input: unknown,
    ): Promise<Result<{ node: NodeRecord | null; pending: number }, ParseError | AclError>> {
      const parsed = parseWith(toolInputs.blackboard_next, input);
      if (!parsed.ok) return parsed;
      if (deps.acl !== null) {
        const gate = checkRead(deps.acl, agent, parsed.value.label);
        if (!gate.ok) return deny(agent, gate.error);
      }
      const found = availableWork(
        state,
        { label: parsed.value.label, match: parsed.value.match },
        deps.now(),
      );
      return ok({ node: found[0] ?? null, pending: found.length });
    },

    async read(input: unknown): Promise<Result<Slice, ParseError | AclError>> {
      const parsed = parseWith(toolInputs.blackboard_read, input);
      if (!parsed.ok) return parsed;
      const root = nodeId(parsed.value.root);
      if (deps.acl === null) return ok(neighborhood(state, root, parsed.value.depth));
      // Asking for an unreadable root is an explicit denial; unreadable neighbors are
      // silently filtered — the engine shapes the slice, the agent never widens it.
      const rootNode = state.nodes.get(root);
      if (rootNode !== undefined) {
        const gate = checkRead(deps.acl, agent, rootNode.label);
        if (!gate.ok) return deny(agent, gate.error);
      }
      return ok(
        readableNeighborhood(state, root, parsed.value.depth, readableLabels(deps.acl, agent)),
      );
    },

    status(): SessionStatus {
      const at = deps.now();
      const byLabel: Record<string, number> = {};
      for (const n of state.nodes.values()) byLabel[n.label] = (byLabel[n.label] ?? 0) + 1;
      let activeClaims = 0;
      for (const c of state.claims.values()) if (c.expiresAt > at) activeClaims += 1;
      return { nodes: state.nodes.size, edges: state.edges.size, activeClaims, byLabel };
    },
  });

  return { connect, snapshot: (): GraphState => state };
};

export type Session = ReturnType<typeof createSession>;
export type AgentConnection = ReturnType<Session["connect"]>;
