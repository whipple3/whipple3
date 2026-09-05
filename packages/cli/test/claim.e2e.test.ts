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
  cwd = mkdtempSync(join(tmpdir(), "w3clm-"));
  const serve = spawn("node", [bin, "serve"], { cwd });
  children.push(serve);
  let out = "";
  serve.stdout.setEncoding("utf8");
  serve.stdout.on("data", (c: string) => {
    out += c;
  });
  await waitFor(() => out.includes("listening"), "serve to announce its socket");
});

describe("whipple3 claim — a shell-callable claim on a file path, identity = --agent", () => {
  it("claims a free path (creating its File node) and exits 0", async () => {
    const r = await run(cwd, "claim", "src/a.ts", "--agent", "feat/sho-1-a");
    expect(r.stderr).toBe("");
    expect(r.stdout).toBe("claimed src/a.ts\n");
    expect(r.code).toBe(0);
  });

  it("a second identity is refused, told the TRUE holder, and exits 2", async () => {
    const r = await run(cwd, "claim", "src/a.ts", "--agent", "feat/sho-2-b");
    expect(r.stdout).toBe("held src/a.ts by feat/sho-1-a\n");
    expect(r.code).toBe(2);
  });

  it("the holder claiming again renews, not fails", async () => {
    const r = await run(cwd, "claim", "src/a.ts", "--agent", "feat/sho-1-a");
    expect(r.stdout).toBe("claimed src/a.ts\n");
    expect(r.code).toBe(0);
  });

  it("many paths in one call: every line reported, exit 2 if ANY is held by another", async () => {
    const r = await run(cwd, "claim", "src/b.ts", "src/a.ts", "--agent", "feat/sho-2-b");
    expect(r.stdout).toBe("claimed src/b.ts\nheld src/a.ts by feat/sho-1-a\n");
    expect(r.code).toBe(2);
  });

  it("release by the holder frees the path for the next identity", async () => {
    const rel = await run(cwd, "release", "src/a.ts", "--agent", "feat/sho-1-a");
    expect(rel.stdout).toBe("released src/a.ts\n");
    expect(rel.code).toBe(0);
    const r = await run(cwd, "claim", "src/a.ts", "--agent", "feat/sho-2-b");
    expect(r.stdout).toBe("claimed src/a.ts\n");
    expect(r.code).toBe(0);
  });

  it("release by a non-holder is refused and exits 2", async () => {
    const r = await run(cwd, "release", "src/a.ts", "--agent", "feat/sho-1-a");
    expect(r.stdout).toBe("not held src/a.ts\n");
    expect(r.code).toBe(2);
  });

  it("no board: says so on stderr and exits 1 — never a silent pass", async () => {
    const empty = mkdtempSync(join(tmpdir(), "w3clm-none-"));
    const r = await run(empty, "claim", "src/a.ts", "--agent", "x");
    expect(r.stdout).toBe("");
    expect(r.stderr).toContain("no board socket");
    expect(r.code).toBe(1);
  });
});
