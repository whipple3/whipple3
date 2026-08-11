import {
  type AclError,
  type AclPolicy,
  type AgentId,
  availableWork,
  checkRead,
  edgeId,
  type GraphState,
  type Mutation,
  type MutationError,
  type NodeRecord,
  neighborhood,
  nodeId,
  ok,
  type Result,
  readableLabels,
  readableNeighborhood,
  type Slice,
  type SliceDecl,
  sliceFor,
  type TxId,
  type Version,
  version,
  type Whipple3Event,
} from "@whipple3/core";
import type { z } from "zod";
import { type ParseError, parseWith } from "./parse.js";
import { toolInputs } from "./tools.js";

/** Engine-owned read scope for agents without a declared slice. Agents never choose. */
const DEFAULT_READ_DEPTH = 2;

export type SessionError = ParseError | AclError | MutationError;

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

/**
 * Everything a connection needs from its session, passed explicitly: the mutable
 * GraphState stays owned by session.ts (read through `state()`); writes go through
 * `commit`, denials through `deny`, observational taxonomy events through `note`.
 * Split from session.ts purely for the file budget (SPEC §9.3) — the same closure
 * data as before, now named.
 */
export interface ConnectionCtx {
  readonly acl: AclPolicy | null;
  readonly slices: Readonly<Record<string, SliceDecl>> | undefined;
  readonly now: () => number;
  readonly state: () => GraphState;
  readonly commit: (
    agent: AgentId,
    m: Mutation,
  ) => Promise<Result<{ readonly tx: TxId; readonly version: Version | null }, SessionError>>;
  readonly deny: (agent: AgentId, e: AclError) => Promise<Result<never, AclError>>;
  readonly note: (agent: AgentId, event: Whipple3Event) => Promise<void>;
}

/**
 * Identity enters here, once per connection — payloads cannot assert or override it.
 * stdio: one server process per connection (the transport passes its bound agent);
 * UDS: one socket per agent, same principle. (SPEC §4.6)
 */
export const createConnection = (ctx: ConnectionCtx, agent: AgentId) => ({
  async post(
    input: unknown,
  ): Promise<Result<{ txId: TxId; version: Version | null }, SessionError>> {
    const parsed = parseWith(toolInputs.blackboard_post, input);
    if (!parsed.ok) return parsed;
    const m = brandMutation(parsed.value.mutation);
    const committed = await ctx.commit(agent, m);
    if (!committed.ok) return committed;
    return ok({ txId: committed.value.tx, version: committed.value.version });
  },

  async claim(input: unknown): Promise<Result<{ txId: TxId; expiresAt: number }, SessionError>> {
    const parsed = parseWith(toolInputs.blackboard_claim, input);
    if (!parsed.ok) return parsed;
    const at = ctx.now();
    const id = nodeId(parsed.value.id);
    const committed = await ctx.commit(agent, {
      kind: "CLAIM_NODE",
      id,
      agentId: agent,
      now: at,
      ttlMs: parsed.value.ttlMs,
    });
    if (!committed.ok) return committed;
    // Observational taxonomy event; replay truth stays graph.mutation. claim.expired
    // stays unemitted until the push scheduler owns a clock. (SPEC §7)
    await ctx.note(agent, {
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
    const committed = await ctx.commit(agent, { kind: "RELEASE_NODE", id, agentId: agent });
    if (!committed.ok) return committed;
    await ctx.note(agent, {
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
    if (ctx.acl !== null) {
      const gate = checkRead(ctx.acl, agent, parsed.value.label);
      if (!gate.ok) return ctx.deny(agent, gate.error);
    }
    const found = availableWork(
      ctx.state(),
      { label: parsed.value.label, match: parsed.value.match },
      ctx.now(),
    );
    return ok({ node: found[0] ?? null, pending: found.length });
  },

  async read(input: unknown): Promise<Result<Slice, ParseError | AclError>> {
    const parsed = parseWith(toolInputs.blackboard_read, input);
    if (!parsed.ok) return parsed;
    const state = ctx.state();
    const root = nodeId(parsed.value.root);
    const decl = ctx.slices?.[agent as string];
    if (ctx.acl === null) {
      // No ACL: a declaration is still a bound — its own labels are the readable set.
      if (decl !== undefined) return ok(sliceFor(state, root, decl, declLabels(decl)));
      return ok(neighborhood(state, root, DEFAULT_READ_DEPTH));
    }
    // Asking for an unreadable root is an explicit denial; unreadable neighbors are
    // silently filtered — the engine shapes the slice, the agent never widens it.
    const rootNode = state.nodes.get(root);
    if (rootNode !== undefined) {
      const gate = checkRead(ctx.acl, agent, rootNode.label);
      if (!gate.ok) return ctx.deny(agent, gate.error);
    }
    const readable = readableLabels(ctx.acl, agent);
    if (decl !== undefined) return ok(sliceFor(state, root, decl, readable));
    return ok(readableNeighborhood(state, root, DEFAULT_READ_DEPTH, readable));
  },

  // Async by contract even though local: a socket proxy cannot honor a sync status. (W2-B)
  async status(): Promise<SessionStatus> {
    const at = ctx.now();
    const state = ctx.state();
    // Same rule as read: an unreadable label leaks neither its name nor its counts,
    // and an edge counts only when its label AND both endpoints are readable. (ADR-008)
    const readable = ctx.acl === null ? null : new Set(readableLabels(ctx.acl, agent));
    const canSee = (label: string): boolean => readable === null || readable.has(label);
    const nodeVisible = (id: string): boolean => {
      const n = state.nodes.get(nodeId(id));
      return n !== undefined && canSee(n.label);
    };
    const byLabel: Record<string, number> = {};
    let nodes = 0;
    for (const n of state.nodes.values()) {
      if (!canSee(n.label)) continue;
      nodes += 1;
      byLabel[n.label] = (byLabel[n.label] ?? 0) + 1;
    }
    let edges = 0;
    for (const e of state.edges.values())
      if (canSee(e.label) && nodeVisible(e.from) && nodeVisible(e.to)) edges += 1;
    let activeClaims = 0;
    for (const c of state.claims.values())
      if (c.expiresAt > at && nodeVisible(c.nodeId)) activeClaims += 1;
    return { nodes, edges, activeClaims, byLabel };
  },
});
