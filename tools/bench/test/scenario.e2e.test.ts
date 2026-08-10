import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJsonlLog } from "@whipple3/log";
import { describe, expect, it } from "vitest";
import { extractBoardMetrics } from "../src/board.js";
import { runAuditScenario } from "../src/scenario.js";

/**
 * The pipeline proof's real half: the board log is produced by the REAL `whipple3 serve`
 * backend and four `mcp --board` proxies driving a fixed audit script — no LLM anywhere.
 */
describe("runAuditScenario — deterministic audit over the real serve backend", () => {
  it("produces a board log whose metrics are exactly the scripted ones", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "bench-scenario-"));
    const boardLog = await runAuditScenario(cwd);
    expect(boardLog).toContain(join(cwd, ".whipple3"));

    const records = await createJsonlLog(boardLog).read();
    const m = extractBoardMetrics(records);

    // scanner posts 3 CodeFiles; auditors add 2 SecurityIssues.
    expect(m.findingsByLabel).toEqual({ CodeFile: 3, SecurityIssue: 2 });
    // f3: auditor-3 abandons (ttl expiry), auditor-2 re-claims and re-audits.
    expect(m.contestedClaims).toBe(1);
    expect(m.reworkedNodes).toBe(1);
    // The blocked ALREADY_CLAIMED attempt on f1 is asserted inside the scenario and is
    // NOT in the log — rejected mutations are never appended (honest blind spot).
    expect(m.denials).toBe(0);
    expect(m.agents).toEqual(["auditor-1", "auditor-2", "auditor-3", "scanner"]);

    const types = records.map((r) => r.event.type);
    expect(types.filter((t) => t === "claim.acquired")).toHaveLength(4);
    expect(types.filter((t) => t === "claim.released")).toHaveLength(1);
  });
});
