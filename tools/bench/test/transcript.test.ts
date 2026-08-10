import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseTranscript } from "../src/transcript.js";

const fixture = readFileSync(new URL("./fixtures/main-session.jsonl", import.meta.url), "utf8");

describe("parseTranscript — the real Claude Code session format, tolerated strictly", () => {
  it("keeps every well-formed line and counts malformed ones", () => {
    const t = parseTranscript(fixture);
    expect(t.malformed).toBe(1);
    expect(t.records).toHaveLength(11);
  });

  it("classifies assistant lines with requestId, usage, and single content block", () => {
    const t = parseTranscript(fixture);
    const assistants = t.records.filter((r) => r.kind === "assistant");
    expect(assistants).toHaveLength(6);

    const first = assistants[0];
    expect(first).toMatchObject({
      kind: "assistant",
      sidechain: false,
      requestId: "req_1",
      toolUse: null,
      usage: { input: 3, cacheCreation: 1000, cacheRead: 2000, output: 5 },
    });
    expect(first?.timestamp).toBe(Date.parse("2026-08-11T10:00:30.000Z"));
  });

  it("surfaces tool_use blocks by tool name", () => {
    const t = parseTranscript(fixture);
    const tools = t.records.flatMap((r) =>
      r.kind === "assistant" && r.toolUse !== null ? [r.toolUse] : [],
    );
    expect(tools).toEqual(["Task", "Bash"]);
  });

  it("marks inline sidechain lines (old format) so extraction can skip them", () => {
    const t = parseTranscript(fixture);
    const sidechains = t.records.filter((r) => r.sidechain);
    expect(sidechains).toHaveLength(1);
    expect(sidechains[0]?.kind).toBe("assistant");
  });

  it("keeps synthetic assistant lines (no requestId, no usage) without inventing tokens", () => {
    const t = parseTranscript(fixture);
    const synthetic = t.records.filter(
      (r) => r.kind === "assistant" && r.requestId === null && !r.sidechain,
    );
    expect(synthetic).toHaveLength(1);
    expect(synthetic[0]).toMatchObject({ usage: null });
  });

  it("retains non-message record types (summary, queue-operation, system) as data points", () => {
    const t = parseTranscript(fixture);
    const kinds = t.records.map((r) => r.kind);
    expect(kinds.filter((k) => k === "user")).toHaveLength(2);
    expect(kinds.filter((k) => k === "system")).toHaveLength(1);
    expect(kinds.filter((k) => k === "other")).toHaveLength(2); // summary + queue-operation
  });
});
