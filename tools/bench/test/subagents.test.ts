import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadSessionMetrics } from "../src/subagents.js";

const assistantLine = (requestId: string, output: number, sidechain: boolean): string =>
  JSON.stringify({
    type: "assistant",
    isSidechain: sidechain,
    uuid: `u-${requestId}`,
    timestamp: "2026-08-11T12:00:00.000Z",
    requestId,
    message: {
      role: "assistant",
      model: "claude-fable-5",
      content: [{ type: "text", text: "work" }],
      usage: {
        input_tokens: 10,
        cache_creation_input_tokens: 100,
        cache_read_input_tokens: 1000,
        output_tokens: output,
      },
    },
  });

const writeSession = (withSubagents: boolean): string => {
  const dir = mkdtempSync(join(tmpdir(), "bench-sub-"));
  const main = join(dir, "abc123.jsonl");
  writeFileSync(main, `${assistantLine("req_m1", 50, false)}\n`);
  if (withSubagents) {
    const sub = join(dir, "abc123", "subagents");
    mkdirSync(sub, { recursive: true });
    writeFileSync(join(sub, "agent-a1.jsonl"), `${assistantLine("req_s1", 20, true)}\n`);
    writeFileSync(
      join(sub, "agent-a2.jsonl"),
      `${assistantLine("req_s2", 30, true)}\n${assistantLine("req_s3", 40, true)}\n`,
    );
    writeFileSync(join(sub, "agent-a1.meta.json"), JSON.stringify({ agentType: "auditor" }));
  }
  return main;
};

describe("loadSessionMetrics — main transcript plus subagent sidecar files", () => {
  it("reports null subagent totals when the session has no subagents directory", () => {
    const m = loadSessionMetrics(writeSession(false));
    expect(m.main.requests).toBe(1);
    expect(m.main.outputTokens).toBe(50);
    expect(m.subagents).toBeNull();
  });

  it("aggregates every agent-*.jsonl — sidechain flags do not hide their own usage", () => {
    const m = loadSessionMetrics(writeSession(true));
    expect(m.main.contextInTokens).toBe(1110);
    expect(m.subagents).toEqual({
      files: 2,
      requests: 3,
      contextInTokens: 3 * 1110,
      outputTokens: 20 + 30 + 40,
    });
  });
});
