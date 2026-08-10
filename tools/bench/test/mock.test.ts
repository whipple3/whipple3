import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderComparison } from "../src/compare.js";
import { mockVanillaSession, mockWhipple3Session, writeMockSession } from "../src/mock.js";
import { loadSessionMetrics } from "../src/subagents.js";
import { parseTranscript } from "../src/transcript.js";

const dir = mkdtempSync(join(tmpdir(), "bench-mock-"));
const w3Path = writeMockSession(dir, "whipple3-main", mockWhipple3Session());
const vanillaPath = writeMockSession(dir, "vanilla-main", mockVanillaSession());
const w3 = loadSessionMetrics(w3Path);
const vanilla = loadSessionMetrics(vanillaPath);

describe("mock transcript pair — synthetic but format-true, exact predeclared numbers", () => {
  it("whipple3 main thread: 3 requests, small context, Task x3 + Bash", () => {
    expect(w3.main.requests).toBe(3);
    expect(w3.main.contextInTokens).toBe(37_812);
    expect(w3.main.outputTokens).toBe(850);
    expect(w3.main.contextTokens).toBe(38_662);
    expect(w3.main.wallMs).toBe(360_000);
    expect(w3.main.toolCallsByName).toEqual({ Bash: 1, Task: 3 });
    expect(w3.main.malformedLines).toBe(0);
    expect(w3.main.sidechainLines).toBe(0);
  });

  it("whipple3 sidecars: three auditors, fixed totals, no meta files → untyped", () => {
    const perFile = { agentType: null, requests: 2, contextInTokens: 20_000, outputTokens: 500 };
    expect(w3.subagents).toEqual({
      files: 3,
      requests: 6,
      contextInTokens: 60_000,
      outputTokens: 1_500,
      byAgent: [perFile, perFile, perFile],
    });
  });

  it("vanilla main thread: findings funneled through the parent — fat context, faster wall", () => {
    expect(vanilla.main.requests).toBe(4);
    expect(vanilla.main.contextInTokens).toBe(85_704);
    expect(vanilla.main.outputTokens).toBe(2_630);
    expect(vanilla.main.contextTokens).toBe(88_334);
    expect(vanilla.main.wallMs).toBe(300_000);
    expect(vanilla.main.toolCallsByName).toEqual({ Task: 3 });
  });

  it("vanilla sidecars: three auditors, fixed totals, no meta files → untyped", () => {
    const perFile = { agentType: null, requests: 2, contextInTokens: 21_000, outputTokens: 600 };
    expect(vanilla.subagents).toEqual({
      files: 3,
      requests: 6,
      contextInTokens: 63_000,
      outputTokens: 1_800,
      byAgent: [perFile, perFile, perFile],
    });
  });

  it("is format-true: one line per content block, shared requestId, cumulative output", () => {
    const records = parseTranscript(mockWhipple3Session().main).records;
    const spawn = records.filter((r) => r.kind === "assistant" && r.requestId === "req_w1");
    expect(spawn).toHaveLength(5); // thinking + text + three Task tool_use blocks
    const outputs = spawn.map((r) => (r.kind === "assistant" ? (r.usage?.output ?? -1) : -1));
    expect(outputs).toEqual([...outputs].sort((a, b) => a - b)); // cumulative snapshots grow
    expect(outputs.at(-1)).toBe(400);
  });

  it("drives the honest verdict: meets the token target, loses wall time", () => {
    const out = renderComparison(w3, vanilla, null);
    expect(out).toContain(
      "- Orchestrator context: -56.2% — MEETS the >=40% reduction target (SPEC §8).",
    );
    expect(out).toContain("- Wall time: whipple3 LOSES: +20.0% slower.");
    expect(out).toContain("- Total context incl. subagents: -34.6% vs vanilla.");
  });
});
