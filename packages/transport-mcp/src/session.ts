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
  type SliceDecl,
  sliceFor,
  type TxId,
  type Version,
  version,
} from "@whipple3/core";
import type { LogStore } from "@whipple3/log";
import type { z } from "zod";
import { type BoardLifetime, checkPurge, type PurgeError } from "./lifetime.js";
import { type ParseError, parseWith } from "./parse.js";
import { toolInputs } from "./tools.js";

/** Engine-owned read scope for agents without a declared slice. Agents never choose. */
const DEFAULT_READ_DEPTH = 2;

const declLabels = (decl: SliceDecl): readonly string[] => {
  const labels = new Set<string>([decl.root]);
  const walk = (rules: SliceDecl["follow"]): void => {
    for (const r of rules) {
      labels.add(r.edge);
      labels.add(r.from);
      labels.add(r.to);
      walk(r.next);
    }
  };
  walk(decl.follow);
  return [...labels];
};

export type { ParseError } from "./parse.js";

export type SessionError = ParseError | AclError | MutationError;

export interface SessionDeps {
  readonly log: LogStore;
  /** null = no ACL configured: the host's tool allowlist is the only gate. (SPEC §4.6) */
  readonly acl: AclPolicy | null;
  /** Role slices by agent — schema file, never tool payload; agents don't pick scope. (§4.7) */
  readonly slices?: Readonly<Record<string, SliceDecl>> | undefined;
  readonly sessionId: SessionId;
  /** On whose behalf this session runs. Injected: local env in OSS, SSO in enterprise. */
  readonly principal: Principal | null;
  /** Defaults to "ephemeral" — the only implemented mode in v0.1. */
  readonly lifetime?: BoardLifetime;
  readonly now: () => number;
  readonly newTxId: () => TxId;
}

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
  const lifetime = deps.lifetime ?? "ephemeral";
  if (lifetime === "persistent")
    throw new Error(
      "board lifetime 'persistent' is not implemented — only 'ephemeral' boards exist in v0.1 " +
        "(the parameter is reserved so persistence arrives as config, not refactor; ROADMAP Stage 5+)",
    );
  let state: GraphState = emptyState();
  // One trace per session; causation chains arrive with push dispatch (Phase 2, SPEC §4.5).
  const correlationId = deps.newTxId();

  /** agent = null marks a session-level action (distill/purge) — no connection behind it. */
  const meta = (agent: AgentId | null, tx: TxId): EventMeta => ({
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
      const id = nodeId(parsed.value.id);
      const committed = await commit(agent, {
        kind: "CLAIM_NODE",
        id,
        agentId: agent,
        now: at,
        ttlMs: parsed.value.ttlMs,
      });
      if (!committed.ok) return committed;
      // Observational taxonomy event; replay truth stays graph.mutation. claim.expired
      // stays unemitted until the push scheduler owns a clock. (SPEC §7)
      await deps.log.append(meta(agent, deps.newTxId()), {
        type: "claim.acquired",
        nodeId: id as string,
        agentId: agent as string,
      });
      return ok({ txId: committed.value.tx, expiresAt: at + parsed.value.ttlMs });
    },

    async release(input: unknown): Promise<Result<{ txId: TxId }, SessionError>> {
      const parsed = parseWith(toolInputs.blackboard_release, input);
      if (!parsed.ok) return parsed;
      const id = nodeId(parsed.value.id);
      const committed = await commit(agent, { kind: "RELEASE_NODE", id, agentId: agent });
      if (!committed.ok) return committed;
      await deps.log.append(meta(agent, deps.newTxId()), {
        type: "claim.released",
        nodeId: id as string,
        agentId: agent as string,
      });
      return ok({ txId: committed.value.tx });
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
      const decl = deps.slices?.[agent as string];
      if (deps.acl === null) {
        // No ACL: a declaration is still a bound — its own labels are the readable set.
        if (decl !== undefined) return ok(sliceFor(state, root, decl, declLabels(decl)));
        return ok(neighborhood(state, root, DEFAULT_READ_DEPTH));
      }
      // Asking for an unreadable root is an explicit denial; unreadable neighbors are
      // silently filtered — the engine shapes the slice, the agent never widens it.
      const rootNode = state.nodes.get(root);
      if (rootNode !== undefined) {
        const gate = checkRead(deps.acl, agent, rootNode.label);
        if (!gate.ok) return deny(agent, gate.error);
      }
      const readable = readableLabels(deps.acl, agent);
      if (decl !== undefined) return ok(sliceFor(state, root, decl, readable));
      return ok(readableNeighborhood(state, root, DEFAULT_READ_DEPTH, readable));
    },

    // Async by contract even though local: a socket proxy cannot honor a sync status. (W2-B)
    async status(): Promise<SessionStatus> {
      const at = deps.now();
      const byLabel: Record<string, number> = {};
      for (const n of state.nodes.values()) byLabel[n.label] = (byLabel[n.label] ?? 0) + 1;
      let activeClaims = 0;
      for (const c of state.claims.values()) if (c.expiresAt > at) activeClaims += 1;
      return { nodes: state.nodes.size, edges: state.edges.size, activeClaims, byLabel };
    },
  });

  /** Tier 3 of the lifecycle: record that the run's findings were exported. (SPEC §4.3) */
  const distill = async (summary: string): Promise<{ txId: TxId }> => {
    const tx = deps.newTxId();
    await deps.log.append(meta(null, tx), { type: "session.distilled", summary });
    return { txId: tx };
  };

  /**
   * Tier 1 of the lifecycle: discard the working graph. EXPLICIT by contract — nothing
   * in this module calls it; a session ending, distilling, or disconnecting never does.
   * The trace log (tier 2) is untouched: replay can always reconstruct. (SPEC §4.8)
   */
  const purge = async (): Promise<Result<{ txId: TxId }, PurgeError>> => {
    const gate = checkPurge(lifetime);
    if (!gate.ok) return gate;
    state = emptyState();
    const tx = deps.newTxId();
    await deps.log.append(meta(null, tx), { type: "session.purged" });
    return ok({ txId: tx });
  };

  return { connect, snapshot: (): GraphState => state, distill, purge };
};

export type Session = ReturnType<typeof createSession>;
export type AgentConnection = ReturnType<Session["connect"]>;
