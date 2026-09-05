import {
  agentId,
  bump,
  edgeId,
  INITIAL_VERSION,
  type LogRecord,
  type Mutation,
  nodeId,
  sessionId,
  txId,
  type Version,
} from "@whipple3/core";
import type { AgentTranscript } from "./session.js";
import { primaryTarget } from "./target.js";

/**
 * Project a Claude Code session into the log shape the Studio already renders.
 *
 * Two node kinds. **Agents** are one node each. **Targets** — the file, command or URL a
 * call was aimed at — are one node each and are SHARED between the agents that touched
 * them, because that sharing is real: two agents reading one file genuinely stand in a
 * relation, through the file. Nothing here invents an edge; it draws the ones the session
 * already had and nobody could see.
 *
 * What comes out is not a coordination diagram. A transcript records what each agent DID,
 * never what any of them shared — there is no shared state in it to read. So most agents
 * land isolated, and the clusters are the places where a fleet paid twice without knowing.
 * Describe it as contention and its absence; never as coordination.
 */

/** Only targets more than one agent touched become nodes — see `SHARED_THRESHOLD`. */
const SHARED_THRESHOLD = 2;

/** Ids cross verbatim into the Studio and into report markdown (SPEC §6). */
const slug = (s: string): string =>
  s
    .toLowerCase()
    .replaceAll(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "x";

/** Distinct ids for two long targets that slug to the same 48 chars. */
const fingerprint = (s: string): string => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(36);
};

const targetId = (target: string): string => {
  const tail = target.split("/").slice(-2).join("/");
  return `target:${slug(tail)}-${fingerprint(target)}`;
};

interface Touch {
  readonly tool: string;
  readonly target: string | null;
  readonly ts: number;
}

const touches = (t: AgentTranscript): readonly Touch[] => {
  const out: Touch[] = [];
  let last = 0;
  for (const record of t.transcript.records) {
    if (record.timestamp !== null) last = record.timestamp;
    if (record.kind !== "assistant" || record.toolUse === null) continue;
    out.push({
      tool: record.toolUse,
      target: primaryTarget(record.toolUse, record.toolInput),
      ts: record.timestamp ?? last,
    });
  }
  return out;
};

export interface Projection {
  readonly records: readonly LogRecord[];
  readonly agents: number;
  readonly subagents: number;
  readonly calls: number;
  /** Targets more than one agent touched — the clusters in the picture. */
  readonly sharedTargets: number;
  /** Calls aimed at one of those: work the fleet bought more than once. */
  readonly sharedCalls: number;
}

export const projectSession = (agents: readonly AgentTranscript[]): Projection => {
  const session = sessionId(`transcript-${agents.length}`);
  const records: LogRecord[] = [];

  const emit = (agent: string, ts: number, mutation: Mutation): void => {
    const tx = txId(`t-${records.length}`);
    records.push({
      seq: records.length,
      meta: {
        txId: tx,
        sessionId: session,
        agentId: agentId(agent),
        principal: null,
        ts,
        causationId: null,
        correlationId: tx,
      },
      event: { type: "graph.mutation", mutation },
    });
  };

  const work = agents.map((a) => ({ agent: a, name: slug(a.name), touches: touches(a) }));

  // Who touched what, before anything is drawn: a target is only worth a node once a
  // second agent reaches it, and that is knowable only across the whole session.
  const reach = new Map<string, Set<string>>();
  for (const { name, touches: ts } of work)
    for (const touch of ts)
      if (touch.target !== null)
        (reach.get(touch.target) ?? reach.set(touch.target, new Set()).get(touch.target))?.add(
          name,
        );
  const shared = new Set(
    [...reach].filter(([, who]) => who.size >= SHARED_THRESHOLD).map(([t]) => t),
  );

  const start = Math.min(...work.flatMap((w) => w.touches.map((t) => t.ts)), Date.now());

  for (const { agent, name, touches: ts } of work) {
    const sharedHere = new Set(
      ts.filter((t) => t.target !== null && shared.has(t.target)).map((t) => t.target),
    );
    emit(name, start, {
      kind: "ADD_NODE",
      id: nodeId(`agent:${name}`),
      label: "agent",
      props: {
        name: agent.name,
        kind: agent.kind,
        toolCalls: ts.length,
        // Named, not hidden: calls with no comparable target are counted, never drawn.
        untargetedCalls: ts.filter((t) => t.target === null).length,
        sharedTargets: sharedHere.size,
      },
    });
  }

  const timeline = work
    .flatMap(({ name, touches: ts }) => ts.map((touch) => ({ name, touch })))
    .filter(({ touch }) => touch.target !== null && shared.has(touch.target))
    .sort((a, b) => a.touch.ts - b.touch.ts);

  const versions = new Map<string, Version>();
  const counts = new Map<string, { calls: number; agents: Set<string> }>();
  let sharedCalls = 0;

  for (const { name, touch } of timeline) {
    if (touch.target === null) continue;
    sharedCalls++;
    const id = targetId(touch.target);
    const seen = versions.get(id);
    const tally = counts.get(id) ?? { calls: 0, agents: new Set<string>() };
    tally.calls++;
    const firstForThisAgent = !tally.agents.has(name);
    tally.agents.add(name);
    counts.set(id, tally);

    if (seen === undefined) {
      emit(name, touch.ts, {
        kind: "ADD_NODE",
        id: nodeId(id),
        label: "target",
        props: { target: touch.target, tool: touch.tool, calls: 1, agents: 1 },
      });
      versions.set(id, INITIAL_VERSION);
    } else {
      emit(name, touch.ts, {
        kind: "UPDATE_NODE",
        id: nodeId(id),
        expectedVersion: seen,
        props: { calls: tally.calls, agents: tally.agents.size },
      });
      versions.set(id, bump(seen));
    }

    if (firstForThisAgent)
      emit(name, touch.ts, {
        kind: "ADD_EDGE",
        id: edgeId(`touched:${name}:${id}`),
        label: touch.tool,
        from: nodeId(`agent:${name}`),
        to: nodeId(id),
      });
  }

  return {
    records,
    agents: agents.length,
    subagents: agents.filter((a) => a.kind === "subagent").length,
    calls: work.reduce((n, w) => n + w.touches.length, 0),
    sharedTargets: shared.size,
    sharedCalls,
  };
};
