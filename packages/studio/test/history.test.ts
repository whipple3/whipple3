import { agentId, type LogRecord, nodeId, version } from "@whipple3/core";
import { describe, expect, it } from "vitest";
import { nodeHistory } from "../src/history.js";
import { recordOf } from "./fixtures.js";

const addNode = (seq: number, id: string, label = "file"): LogRecord =>
  recordOf(seq, {
    type: "graph.mutation",
    mutation: { kind: "ADD_NODE", id: nodeId(id), label, props: { path: `src/${id}.ts` } },
  });

const updateNode = (seq: number, id: string, expected: number): LogRecord =>
  recordOf(seq, {
    type: "graph.mutation",
    mutation: {
      kind: "UPDATE_NODE",
      id: nodeId(id),
      expectedVersion: version(expected),
      props: { status: "audited" },
    },
  });

const RECORDS: readonly LogRecord[] = [
  addNode(0, "f1"),
  addNode(1, "f2"),
  recordOf(2, { type: "claim.acquired", nodeId: nodeId("f1"), agentId: agentId("auditor-1") }),
  updateNode(3, "f1", 1),
  recordOf(4, {
    type: "graph.mutation",
    mutation: {
      kind: "RELEASE_NODE",
      id: nodeId("f1"),
      agentId: agentId("auditor-1"),
    },
  }),
  recordOf(5, { type: "claim.released", nodeId: nodeId("f1"), agentId: agentId("auditor-1") }),
  recordOf(6, { type: "acl.denied", agentId: agentId("fixer"), label: "file", reason: "write" }),
  recordOf(7, { type: "acl.denied", agentId: agentId("fixer"), label: "secret", reason: "read" }),
];

const historyOf = (id: string, upTo = RECORDS.length - 1) => nodeHistory(RECORDS, id, upTo);

describe("nodeHistory", () => {
  it("collects added and updated entries with the acting agent and props", () => {
    const entries = historyOf("f1");

    const added = entries.find((e) => e.kind === "added");
    const updated = entries.find((e) => e.kind === "updated");
    expect(added).toMatchObject({ seq: 0, ts: 0, agentId: agentId("writer") });
    expect(added?.detail).toContain("path=src/f1.ts");
    expect(updated).toMatchObject({ seq: 3, agentId: agentId("writer") });
    expect(updated?.detail).toContain("status=audited");
  });

  it("collects claimed/released from claim.* events, skipping the twin mutations", () => {
    const entries = historyOf("f1");

    expect(entries.filter((e) => e.kind === "claimed")).toHaveLength(1);
    expect(entries.filter((e) => e.kind === "released")).toHaveLength(1);
    expect(entries.find((e) => e.kind === "claimed")).toMatchObject({
      seq: 2,
      agentId: agentId("auditor-1"),
    });
  });

  it("keeps entries in seq order and excludes other nodes", () => {
    const entries = historyOf("f1");

    expect(entries.map((e) => e.seq)).toEqual([...entries.map((e) => e.seq)].sort((a, b) => a - b));
    expect(entries.some((e) => e.detail.includes("f2"))).toBe(false);
    expect(historyOf("f2").filter((e) => e.kind !== "denied")).toHaveLength(1);
  });

  it("includes label-scoped denials for the node's label only", () => {
    const denied = historyOf("f1").filter((e) => e.kind === "denied");

    expect(denied).toHaveLength(1);
    expect(denied[0]).toMatchObject({ seq: 6, agentId: agentId("fixer") });
    expect(denied[0]?.detail).toContain("file");
  });

  it("respects the upTo boundary — time travel trims history too", () => {
    const entries = historyOf("f1", 2);

    expect(entries.map((e) => e.kind)).toEqual(["added", "claimed"]);
  });

  it("returns empty for a node that does not exist yet", () => {
    expect(nodeHistory(RECORDS, "f9", RECORDS.length - 1)).toEqual([]);
  });
});
