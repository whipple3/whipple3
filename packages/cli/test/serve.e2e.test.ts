import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const bin = fileURLToPath(new URL("../dist/main.js", import.meta.url));

const children: ChildProcessWithoutNullStreams[] = [];
afterAll(() => {
  for (const c of children) c.kill("SIGKILL");
});

const spawnCli = (cwd: string, ...argv: string[]) => {
  const child = spawn("node", [bin, ...argv], { cwd });
  children.push(child);
  let stdout = "";
  child.stdout.on("data", (chunk: Buffer) => {
    stdout += chunk.toString("utf8");
  });
  return { child, stdout: () => stdout };
};

const waitFor = async (probe: () => boolean, what: string, ms = 5000): Promise<void> => {
  const start = Date.now();
  while (!probe()) {
    if (Date.now() - start > ms) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 25));
  }
};

const exited = (child: ChildProcessWithoutNullStreams): Promise<number | null> =>
  new Promise((resolve) => child.once("exit", (code) => resolve(code)));

describe("whipple3 serve — the board backend owns one session on one socket", () => {
  it("announces the socket, serves it, and SIGTERM unlinks it with a clean exit", async () => {
    if (!existsSync(bin)) throw new Error("dist/main.js missing — run `pnpm build` first");
    const cwd = mkdtempSync(join(tmpdir(), "w3srv-"));
    const serve = spawnCli(cwd, "serve");
    await waitFor(() => serve.stdout().includes("listening"), "serve to announce its socket");

    const socketPath = join(cwd, ".whipple3", "board.sock");
    expect(existsSync(socketPath)).toBe(true);

    serve.child.kill("SIGTERM");
    expect(await exited(serve.child)).toBe(0);
    expect(existsSync(socketPath)).toBe(false);
  });
});
