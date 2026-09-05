import { emptyState, replay } from "@whipple3/core";
import { describe, expect, it } from "vitest";
import { type AgentTranscript, projectSession } from "../src/index.js";

const read = (path: string, timestamp: number) => ({
  kind: "assistant" as const,
  sidechain: false,
  timestamp,
  requestId: "r",
  usage: null,
  toolUse: "Read",
  toolInput: { file_path: path },
});

const agent = (name: string, kind: "main" | "subagent", reads: [string, number][]) =>
  ({
    name,
    kind,
    transcript: { records: reads.map(([p, ts]) => read(p, ts)), malformed: 0 },
  }) satisfies AgentTranscript;

const mutations = (records: ReturnType<typeof projectSession>["records"]) =>
  records.flatMap((r) => (r.event.type === "graph.mutation" ? [r.event.mutation] : []));

describe("projectSession — agents, and the targets they unknowingly shared", () => {
  // /shared.ts is read by all three; /only-a.ts by one. b reads /shared.ts twice.
  const session = [
    agent("a", "main", [
      ["/shared.ts", 100],
      ["/only-a.ts", 150],
    ]),
    agent("b", "subagent", [
      ["/shared.ts", 200],
      ["/shared.ts", 250],
    ]),
    agent("c", "subagent", [["/shared.ts", 300]]),
  ];

  it("gives every agent a node and reports what it could not draw", () => {
    const { records, agents, subagents, calls } = projectSession(session);
    expect({ agents, subagents, calls }).toEqual({ agents: 3, subagents: 2, calls: 5 });
    const nodes = mutations(records).filter((m) => m.kind === "ADD_NODE" && m.label === "agent");
    expect(nodes).toHaveLength(3);
  });

  it("a target two agents touched is ONE shared node, with an edge from each", () => {
    const { records, sharedTargets } = projectSession(session);
    const targets = mutations(records).filter((m) => m.kind === "ADD_NODE" && m.label === "target");
    expect(sharedTargets).toBe(1);
    expect(targets).toHaveLength(1); // /shared.ts — and NOT /only-a.ts
    expect(mutations(records).filter((m) => m.kind === "ADD_EDGE")).toHaveLength(3);
  });

  it("a target only one agent touched gets no node — it says nothing about the fleet", () => {
    const solo = projectSession([agent("a", "main", [["/only-a.ts", 1]])]);
    expect(solo.sharedTargets).toBe(0);
    expect(
      mutations(solo.records).filter((m) => m.kind === "ADD_NODE" && m.label === "target"),
    ).toHaveLength(0);
  });

  it("counts untargeted calls on the agent rather than dropping them silently", () => {
    const opaque = projectSession([
      {
        name: "a",
        kind: "main",
        transcript: {
          records: [{ ...read("/x", 1), toolUse: "mcp__thing__do", toolInput: { q: 1 } }],
          malformed: 0,
        },
      },
    ]);
    const node = mutations(opaque.records).find((m) => m.kind === "ADD_NODE");
    expect(node?.kind === "ADD_NODE" && node.props.untargetedCalls).toBe(1);
  });

  it("a repeat touch bumps the counter instead of adding a second node", () => {
    const { records } = projectSession(session);
    const updates = mutations(records).filter((m) => m.kind === "UPDATE_NODE");
    expect(updates.length).toBeGreaterThan(0);
    const last = updates.at(-1);
    expect(last?.kind === "UPDATE_NODE" && last.props).toEqual({ calls: 4, agents: 3 });
  });

  it("folds cleanly through the real reducer — a valid log, not a lookalike", () => {
    const { records } = projectSession(session);
    expect(replay(mutations(records), emptyState()).rejected).toEqual([]);
    expect(records.map((r) => r.seq)).toEqual(records.map((_, i) => i));
  });

  it("orders shared touches by time, so the scrubber replays the contention as it happened", () => {
    const { records } = projectSession(session);
    const shared = records.filter(
      (r) => r.event.type === "graph.mutation" && r.event.mutation.kind !== "ADD_NODE",
    );
    const times = shared.map((r) => r.meta.ts);
    expect(times).toEqual([...times].sort((x, y) => x - y));
  });
});
