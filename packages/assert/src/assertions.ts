import type { Mutation, NodeRecord } from "@whipple3/core";
import type { Session } from "./session.js";

/**
 * Assertions over a coordination trajectory, not over text.
 *
 * Existing eval tools judge what an agent SAID. These judge what a fleet of agents
 * LEFT BEHIND: the typed state at the end, and the enforcement record of getting there.
 * Every one is a pure function of the log, so it is deterministic even though the models
 * are not — which is the only reason a coordination regression can fail a build.
 *
 * Deliberately absent, because v0.1 emits no data for them and a green assertion over an
 * empty stream is worse than no assertion: **hop budgets** (`EventMeta.causationId` is
 * always null until the push scheduler chains it) and **cost ceilings** (`llm.call` is in
 * the taxonomy and nothing emits it). ROADMAP Stage 6/7 unblock both; do not add either
 * until an emitter exists.
 */
export interface Check {
  readonly ok: boolean;
  readonly message: string;
}

export type Assertion = (session: Session) => Check;

export interface Report {
  readonly ok: boolean;
  readonly checks: readonly Check[];
}

const nodesLabelled = (session: Session, label: string): readonly NodeRecord[] =>
  [...session.state.nodes.values()].filter((n) => n.label === label);

const show = (nodes: readonly NodeRecord[], limit = 3): string =>
  nodes
    .slice(0, limit)
    .map((n) => `${n.id} ${JSON.stringify(n.props)}`)
    .join(", ") + (nodes.length > limit ? `, +${nodes.length - limit} more` : "");

/** Every node with this label satisfies the predicate. Vacuously true on zero nodes — see `some`. */
export const every =
  (label: string, predicate: (props: Readonly<Record<string, unknown>>) => boolean): Assertion =>
  (session) => {
    const nodes = nodesLabelled(session, label);
    const failing = nodes.filter((n) => !predicate(n.props));
    return failing.length === 0
      ? { ok: true, message: `every ${label} (${nodes.length}) satisfies the predicate` }
      : {
          ok: false,
          message: `${failing.length}/${nodes.length} ${label} failed: ${show(failing)}`,
        };
  };

/**
 * No node with this label satisfies the predicate — "nothing was left pending".
 *
 * The population is always printed, including when it is zero. A misspelled label passes
 * both `every` and `none` in silence, and a green check that never looked at anything is
 * the worst output this package could produce. Pair either with `atLeast` to make the
 * expectation explicit rather than merely visible.
 */
export const none =
  (label: string, predicate: (props: Readonly<Record<string, unknown>>) => boolean): Assertion =>
  (session) => {
    const population = nodesLabelled(session, label);
    const matching = population.filter((n) => predicate(n.props));
    return matching.length === 0
      ? { ok: true, message: `no ${label} matches the predicate (${population.length} present)` }
      : {
          ok: false,
          message: `${matching.length}/${population.length} ${label}: ${show(matching)}`,
        };
  };

/** At least `n` nodes with this label exist — guards the vacuous pass in `every`. */
export const atLeast =
  (label: string, n: number): Assertion =>
  (session) => {
    const count = nodesLabelled(session, label).length;
    return count >= n
      ? { ok: true, message: `${count} ${label} (≥ ${n})` }
      : { ok: false, message: `only ${count} ${label}, expected at least ${n}` };
  };

/** No agent was refused a read or a write. Denials are events, so this is exact. */
export const noDenials = (): Assertion => (session) => {
  const denied = session.records.flatMap((r) =>
    r.event.type === "acl.denied"
      ? [`${r.event.agentId}→${r.event.label} (${r.event.reason})`]
      : [],
  );
  return denied.length === 0
    ? { ok: true, message: "no acl denials" }
    : { ok: false, message: `${denied.length} acl denials: ${denied.slice(0, 3).join(", ")}` };
};

/** Nothing is still claimed — every worker released or expired out of its work. */
export const allClaimsReleased = (): Assertion => (session) => {
  const held = [...session.state.claims.values()];
  return held.length === 0
    ? { ok: true, message: "no claims held at session end" }
    : {
        ok: false,
        message: `${held.length} still held: ${held.map((c) => `${c.nodeId} by ${c.agentId}`).join(", ")}`,
      };
};

export const run = (session: Session, ...assertions: readonly Assertion[]): Report => {
  const checks = assertions.map((a) => a(session));
  return { ok: checks.every((c) => c.ok), checks };
};

/** One line per check, `✓`/`✗`, for a CI log. */
export const format = (report: Report): string =>
  report.checks.map((c) => `${c.ok ? "✓" : "✗"} ${c.message}`).join("\n");

const prOf = (m: Mutation): number | null => {
  if (m.kind !== "ADD_NODE" && m.kind !== "UPDATE_NODE") return null;
  return typeof m.props.pr === "number" ? m.props.pr : null;
};

const mergedPr = (m: Mutation): number | null => {
  if (m.kind !== "UPDATE_NODE" || m.props.state !== "merged") return null;
  const n = Number(String(m.id).replace(/^pr:/, ""));
  return String(m.id).startsWith("pr:") && Number.isInteger(n) ? n : null;
};

/**
 * Every merge was preceded by an approve on the board, and nothing revoked it before the
 * merge. Read off the log in order — the final state cannot tell "approved then merged"
 * from "merged then approved".
 */
export const approvedBeforeMerge = (): Assertion => (session) => {
  const latest = new Map<number, unknown>();
  const failing: string[] = [];
  for (const r of session.records) {
    if (r.event.type !== "graph.mutation") continue;
    const m = r.event.mutation;
    const reviewed = prOf(m);
    if (reviewed !== null && "props" in m && "verdict" in m.props)
      latest.set(reviewed, m.props.verdict);
    const merged = mergedPr(m);
    if (merged !== null && latest.get(merged) !== "approve") failing.push(`pr:${merged}`);
  }
  return failing.length === 0
    ? { ok: true, message: "every merge followed an approve" }
    : { ok: false, message: `merged without a standing approve: ${failing.join(", ")}` };
};
