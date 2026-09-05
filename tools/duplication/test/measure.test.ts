import { type AgentTranscript, primaryTarget } from "@whipple3/transcript";
import { describe, expect, it } from "vitest";
import { callsOf, measure } from "../src/measure.js";

const call = (toolUse: string, toolInput: unknown) => ({
  kind: "assistant" as const,
  sidechain: false,
  timestamp: 0,
  requestId: null,
  usage: null,
  toolUse,
  toolInput,
});

const agent = (name: string, calls: [string, unknown][]) =>
  ({
    name,
    kind: "subagent",
    transcript: { records: calls.map(([t, i]) => call(t, i)), malformed: 0 },
  }) satisfies AgentTranscript;

describe("primaryTarget — what a call was aimed at", () => {
  it("maps each known tool to its one comparable argument", () => {
    expect(primaryTarget("Read", { file_path: "/a.ts" })).toBe("/a.ts");
    expect(primaryTarget("Bash", { command: "npm ci" })).toBe("npm ci");
    expect(primaryTarget("Grep", { pattern: "foo", path: "src" })).toBe("foo @ src");
    expect(primaryTarget("WebFetch", { url: "https://x" })).toBe("https://x");
  });

  it("returns null rather than guessing, so unknowns leave the denominator", () => {
    expect(primaryTarget("mcp__whatever__do_thing", { anything: 1 })).toBeNull();
    expect(primaryTarget("Task", { subagent_type: "auditor" })).toBeNull();
    expect(primaryTarget("Read", { wrong_field: "/a.ts" })).toBeNull();
  });
});

describe("measure — work paid for more than once", () => {
  const session = [
    agent("a", [
      ["Read", { file_path: "/shared.ts" }],
      ["Read", { file_path: "/only-a.ts" }],
      ["Bash", { command: "npm ci" }],
    ]),
    agent("b", [
      ["Read", { file_path: "/shared.ts" }],
      ["Bash", { command: "npm ci" }],
    ]),
    agent("c", [["Read", { file_path: "/shared.ts" }]]),
  ];

  it("counts every agent after the first on a shared target", () => {
    const r = measure(callsOf(session), "all");
    // /shared.ts: 3 agents → 2 repaid. npm ci: 2 agents → 1. /only-a.ts: 0.
    expect(r.repaid).toBe(3);
    expect(r.comparable).toBe(6);
  });

  it("does not count one agent repeating itself — that is not duplicated work", () => {
    const alone = [
      agent("a", [
        ["Read", { file_path: "/x.ts" }],
        ["Read", { file_path: "/x.ts" }],
      ]),
    ];
    const r = measure(callsOf(alone), "all");
    expect(r.comparable).toBe(2);
    expect(r.repaid).toBe(0);
  });

  it("narrows the denominator with the lens, never silently", () => {
    const all = measure(callsOf(session), "all");
    const reads = measure(callsOf(session), "reads");
    expect(all.comparable).toBe(6);
    expect(reads.comparable).toBe(4); // the two `npm ci` calls drop out
    expect(reads.repaid).toBe(2);
  });

  it("ranks hotspots by how many distinct agents paid", () => {
    expect(measure(callsOf(session), "all").hotspots[0]).toEqual({
      agents: 3,
      tool: "Read",
      target: "/shared.ts",
    });
  });
});
