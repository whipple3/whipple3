import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const bin = fileURLToPath(new URL("../dist/main.js", import.meta.url));

const children: ChildProcessWithoutNullStreams[] = [];
afterAll(() => {
  for (const c of children) c.kill("SIGKILL");
});

interface Run {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

const run = (cwd: string, ...argv: string[]): Promise<Run> =>
  new Promise((resolve) => {
    const child = spawn("node", [bin, ...argv], { cwd });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (c: string) => {
      stdout += c;
    });
    child.stderr.on("data", (c: string) => {
      stderr += c;
    });
    child.once("exit", (code) => resolve({ code, stdout, stderr }));
  });

const waitFor = async (probe: () => boolean, what: string, ms = 5000): Promise<void> => {
  const start = Date.now();
  while (!probe()) {
    if (Date.now() - start > ms) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 25));
  }
};

const policy = fileURLToPath(new URL("../../../examples/review-policy.json", import.meta.url));

let cwd: string;
beforeAll(async () => {
  if (!existsSync(bin)) throw new Error("dist/main.js missing — run `pnpm build` first");
  cwd = mkdtempSync(join(tmpdir(), "w3pol-"));
  const serve = spawn("node", [bin, "serve", "--policy", policy], { cwd });
  children.push(serve);
  let out = "";
  serve.stdout.setEncoding("utf8");
  serve.stdout.on("data", (c: string) => {
    out += c;
  });
  await waitFor(() => out.includes("listening"), "serve to announce its socket");
});

describe("examples/review-policy.json — the verdict is reviewer-only (design §3)", () => {
  it("a branch may open its PR", async () => {
    const r = await run(cwd, "pr", "open", "src/a.ts", "--agent", "feat/x", "--number", "1");
    expect(r.code).toBe(0);
  });

  it("a branch approving itself is refused, exit 1, and the refusal is in the log", async () => {
    const r = await run(
      cwd,
      "review",
      "--agent",
      "feat/x",
      "--number",
      "1",
      "--verdict",
      "approve",
    );
    expect(r.stderr).toContain("ACL_DENIED_WRITE");
    expect(r.code).toBe(1);
    const dir = join(cwd, ".whipple3");
    const log = readdirSync(dir).find((f) => f.endsWith(".ndjson")) ?? "";
    expect(readFileSync(join(dir, log), "utf8")).toContain('"acl.denied"');
  });

  it("the reviewer may approve, and the gate then clears", async () => {
    const r = await run(
      cwd,
      "review",
      "--agent",
      "reviewer-1",
      "--number",
      "1",
      "--verdict",
      "approve",
    );
    expect(r.stderr).toBe("");
    expect(r.code).toBe(0);
    expect((await run(cwd, "pr", "check", "--agent", "feat/x", "--number", "1")).stdout).toBe(
      "clear\n",
    );
  });
});
