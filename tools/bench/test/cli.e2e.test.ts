import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const run = promisify(execFile);
const bin = fileURLToPath(new URL("../dist/main.js", import.meta.url));

/** The full pipeline, exactly as the RUNBOOK invokes it: mock → extract → compare. */
const EXPECTED_TABLE = `# whipple3 vs vanilla — audit benchmark

| metric (main thread) | whipple3 | vanilla | Δ |
| --- | ---: | ---: | ---: |
| orchestrator context (in+out) | 38,662 | 88,334 | -56.2% |
| context in (input+cache write+cache read) | 37,812 | 85,704 | -55.9% |
| output | 850 | 2,630 | -67.7% |
| API requests | 3 | 4 | — |
| tool calls | 4 | 3 | — |
| wall time | 6m 0s | 5m 0s | +20.0% |
| subagent context (sidecar files) | 61,500 (3 files) | 64,800 (3 files) | — |
| total context incl. subagents | 100,162 | 153,134 | -34.6% |

## Board log (whipple3 run)

| metric | value |
| --- | ---: |
| findings | CodeFile: 3, SecurityIssue: 2 |
| contested claims | 1 |
| reworked nodes | 1 |
| ACL denials | 0 |
| agents | auditor-1, auditor-2, auditor-3, scanner |

## Verdict

- Orchestrator context: -56.2% — MEETS the >=40% reduction target (SPEC §8).
- Wall time: whipple3 LOSES: +20.0% slower.
- Duplicate work: 1 contested claim(s), 1 reworked node(s) — DUPLICATE WORK PRESENT.
- Total context incl. subagents: -34.6% vs vanilla.
- Findings quality: not machine-judged — compare the two run reports (RUNBOOK).
`;

describe("bench CLI — the pipeline proof end to end (no LLM anywhere)", () => {
  it("mock writes the pair + real board log and prints the exact comparison", async () => {
    if (!existsSync(bin)) throw new Error("dist/main.js missing — run `pnpm build` first");
    const dir = mkdtempSync(join(tmpdir(), "bench-cli-"));

    const mock = await run("node", [bin, "mock", dir]);
    expect(mock.stdout).toBe(EXPECTED_TABLE);
    expect(readFileSync(join(dir, "comparison.md"), "utf8")).toBe(EXPECTED_TABLE);

    // The board log is REAL: written by a spawned `whipple3 serve` backend.
    const boardLogs = readdirSync(join(dir, ".whipple3")).filter((f) => f.endsWith(".ndjson"));
    expect(boardLogs).toHaveLength(1);

    // compare is deterministic and reproduces the same bytes from the artifacts.
    const compare = await run("node", [
      bin,
      "compare",
      join(dir, "whipple3-main.jsonl"),
      join(dir, "vanilla-main.jsonl"),
      "--board",
      join(dir, ".whipple3", boardLogs[0] ?? ""),
    ]);
    expect(compare.stdout).toBe(EXPECTED_TABLE);
  });

  it("compare without --board omits board rows and says duplicates were not measured", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bench-cli-"));
    await run("node", [bin, "mock", dir]);
    const out = (
      await run("node", [
        bin,
        "compare",
        join(dir, "whipple3-main.jsonl"),
        join(dir, "vanilla-main.jsonl"),
      ])
    ).stdout;
    expect(out).not.toContain("## Board log");
    expect(out).toContain("- Duplicate work: no board log provided (--board) — not measured.");
  });

  it("rejects unknown commands with usage on stderr and a non-zero exit", async () => {
    const failed = run("node", [bin, "frobnicate"]);
    await expect(failed).rejects.toMatchObject({ code: 1 });
    await failed.catch((e: { stderr: string }) => {
      expect(e.stderr).toContain("usage:");
    });
  });
});
