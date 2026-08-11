import {
  type AclError,
  type AclPolicy,
  type AgentId,
  apply,
  checkAcl,
  type EventMeta,
  emptyState,
  err,
  type GraphState,
  type Mutation,
  ok,
  type Principal,
  type Result,
  type SessionId,
  type SliceDecl,
  type TxId,
  type Version,
  type Whipple3Event,
} from "@whipple3/core";
import type { LogStore } from "@whipple3/log";
import { type ConnectionCtx, createConnection, type SessionError } from "./connection.js";
import { type BoardLifetime, checkPurge, type PurgeError } from "./lifetime.js";

export type { SessionError, SessionStatus } from "./connection.js";
export type { ParseError } from "./parse.js";

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

  const doCommit = async (
    agent: AgentId,
    m: Mutation,
  ): Promise<Result<{ tx: TxId; version: Version | null }, SessionError>> => {
    if (deps.acl !== null) {
      const gate = checkAcl(deps.acl, agent, m, state);
      if (!gate.ok) return deny(agent, gate.error);
    }
    const applied = apply(state, m);
    if (!applied.ok) return applied;
    const tx = deps.newTxId();
    // The log is the truth: state publishes only AFTER the event is durable. A failed
    // append is a process-edge exception, and the write simply never happened — the
    // materialized view must not remember what the log cannot replay.
    await deps.log.append(meta(agent, tx), { type: "graph.mutation", mutation: m });
    state = applied.value;
    // Read from the candidate, not shared state: the echo is the version ITS write
    // produced, whatever commits queued meanwhile. (found by W1-A)
    const touched =
      m.kind === "ADD_NODE" || m.kind === "UPDATE_NODE"
        ? (applied.value.nodes.get(m.id)?.version ?? null)
        : null;
    return ok({ tx, version: touched });
  };

  /**
   * Commits serialize on one queue, so gate→apply→append is atomic against other
   * commits: nobody applies onto a state whose append may still fail, and state can
   * never lead the log. A failed commit rejects its caller but never blocks the queue.
   */
  let queued: Promise<unknown> = Promise.resolve();
  const enqueue = <T>(work: () => Promise<T>): Promise<T> => {
    const run = queued.then(work);
    queued = run.catch(() => undefined);
    return run;
  };
  const commit = (
    agent: AgentId,
    m: Mutation,
  ): Promise<Result<{ tx: TxId; version: Version | null }, SessionError>> =>
    enqueue(() => doCommit(agent, m));

  /** Observational taxonomy events (claim.acquired/released) — never replay truth. */
  const note = async (agent: AgentId, event: Whipple3Event): Promise<void> => {
    await deps.log.append(meta(agent, deps.newTxId()), event);
  };

  /** The connection's whole window into this session — state read-only, writes via commit. */
  const ctx: ConnectionCtx = {
    acl: deps.acl,
    slices: deps.slices,
    now: deps.now,
    state: () => state,
    commit,
    deny,
    note,
  };

  /** Identity binds here, once per connection; the handlers live in connection.ts. */
  const connect = (agent: AgentId) => createConnection(ctx, agent);

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
    // Through the commit queue for the same reason commits are: the discard must not
    // interleave with an in-flight append, and it publishes only once it is logged.
    return enqueue(async () => {
      const tx = deps.newTxId();
      await deps.log.append(meta(null, tx), { type: "session.purged" });
      state = emptyState();
      return ok({ txId: tx });
    });
  };

  return { connect, snapshot: (): GraphState => state, distill, purge };
};

export type Session = ReturnType<typeof createSession>;
export type AgentConnection = ReturnType<Session["connect"]>;
