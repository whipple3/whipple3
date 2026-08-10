import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { extractTranscriptMetrics } from "../src/metrics.js";
import { parseTranscript } from "../src/transcript.js";

/**
 * Fixtures distilled from the REAL 2026-08-11 live /whipple3:audit run (session
 * bb721fae, Claude Code 2.1.138, claude-opus-4-7). Only oversized string VALUES were
 * truncated; every structural fact is verbatim. What reality pinned here:
 * - record types beyond user/assistant/system: queue-operation, attachment, last-prompt;
 * - the SessionStart hook attachment carries the EARLIEST timestamp (before the
 *   queue-operation enqueue) — wall time starts there;
 * - usage snapshots within a request are IDENTICAL across its lines in this run (the
 *   format also allows growing snapshots — last-wins covers both);
 * - last-prompt lines have no timestamp at all.
 */
const fixture = readFileSync(new URL("./fixtures/live-main.jsonl", import.meta.url), "utf8");

describe("live run format — main transcript (real bb721fae lines)", () => {
  it("parses every real line: nothing malformed, new record types kept as data", () => {
    const t = parseTranscript(fixture);
    expect(t.malformed).toBe(0);
    expect(t.records).toHaveLength(14);
    const kinds = t.records.map((r) => r.kind);
    expect(kinds.filter((k) => k === "assistant")).toHaveLength(9);
    expect(kinds.filter((k) => k === "user")).toHaveLength(2);
    // queue-operation + attachment + last-prompt — unknown types are data, not errors
    expect(kinds.filter((k) => k === "other")).toHaveLength(3);
  });

  it("dedups identical cumulative snapshots: 9 assistant lines are 3 API requests", () => {
    const m = extractTranscriptMetrics(parseTranscript(fixture));
    expect(m.requests).toBe(3);
    expect(m.inputTokens).toBe(5 + 6 + 1);
    expect(m.cacheCreationTokens).toBe(17_163 + 762 + 1_323);
    expect(m.cacheReadTokens).toBe(22_145 + 39_995 + 44_546);
    expect(m.contextInTokens).toBe(125_946);
    expect(m.outputTokens).toBe(133 + 1_113 + 162);
    expect(m.contextTokens).toBe(127_354);
  });

  it("counts tool calls per line: one Skill, the three parallel-auditor Agent spawns", () => {
    const m = extractTranscriptMetrics(parseTranscript(fixture));
    expect(m.toolCallsByName).toEqual({ Skill: 1, Agent: 3 });
    expect(m.toolCalls).toBe(4);
  });

  it("wall time spans hook attachment → last assistant line; all lines are main-thread", () => {
    const m = extractTranscriptMetrics(parseTranscript(fixture));
    expect(m.wallMs).toBe(
      Date.parse("2026-08-10T22:41:05.530Z") - Date.parse("2026-08-10T22:36:43.002Z"),
    );
    expect(m.sidechainLines).toBe(0);
    expect(m.malformedLines).toBe(0);
  });
});

describe("live run format — subagent sidecar (real scanner lines)", () => {
  const sidecar = readFileSync(new URL("./fixtures/live-subagent.jsonl", import.meta.url), "utf8");

  it("every sidecar line is isSidechain:true with full requestId + usage", () => {
    const t = parseTranscript(sidecar);
    expect(t.malformed).toBe(0);
    expect(t.records).toHaveLength(8);
    expect(t.records.every((r) => r.sidechain)).toBe(true);
    const assistants = t.records.filter((r) => r.kind === "assistant");
    expect(assistants).toHaveLength(5);
    for (const a of assistants) {
      if (a.kind !== "assistant") continue;
      expect(a.requestId).not.toBeNull();
      expect(a.usage).not.toBeNull();
    }
  });

  it("MCP tool names carry the per-agent plugin prefix — proof of per-agent identity", () => {
    const t = parseTranscript(sidecar);
    const tools = t.records.flatMap((r) =>
      r.kind === "assistant" && r.toolUse !== null ? [r.toolUse] : [],
    );
    expect(tools).toContain("mcp__plugin_whipple3_whipple3-scanner__blackboard_post");
  });
});
