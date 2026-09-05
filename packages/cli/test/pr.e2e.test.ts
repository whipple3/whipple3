import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
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

let cwd: string;
beforeAll(async () => {
  if (!existsSync(bin)) throw new Error("dist/main.js missing — run `pnpm build` first");
  cwd = mkdtempSync(join(tmpdir(), "w3pr-"));
  const serve = spawn("node", [bin, "serve"], { cwd });
  children.push(serve);
  let out = "";
  serve.stdout.setEncoding("utf8");
  serve.stdout.on("data", (c: string) => {
    out += c;
  });
  await waitFor(() => out.includes("listening"), "serve to announce its socket");
});

describe("whipple3 pr open — the PR node, its touches edges, its claims", () => {
  it("records the PR and claims its paths, exit 0", async () => {
    const r = await run(
      cwd,
      "pr",
      "open",
      "src/a.ts",
      "src/b.ts",
      "--agent",
      "feat/a",
      "--number",
      "12",
    );
    expect(r.stderr).toBe("");
    expect(r.stdout).toBe("pr 12 opened\nclaimed src/a.ts\nclaimed src/b.ts\n");
    expect(r.code).toBe(0);
  });

  it("a path another branch holds: PR still recorded, holder named, exit 2", async () => {
    await run(cwd, "claim", "src/c.ts", "--agent", "feat/b");
    const r = await run(cwd, "pr", "open", "src/c.ts", "--agent", "feat/a", "--number", "13");
    expect(r.stdout).toBe("pr 13 opened\nheld src/c.ts by feat/b\n");
    expect(r.code).toBe(2);
  });

  it("opening the same number twice is idempotent", async () => {
    const r = await run(cwd, "pr", "open", "src/a.ts", "--agent", "feat/a", "--number", "12");
    expect(r.stdout).toBe("pr 12 opened\nclaimed src/a.ts\n");
    expect(r.code).toBe(0);
  });

  it("a non-numeric --number is refused, exit 1", async () => {
    const r = await run(cwd, "pr", "open", "src/a.ts", "--agent", "feat/a", "--number", "twelve");
    expect(r.stderr).toContain("--number");
    expect(r.code).toBe(1);
  });
});
