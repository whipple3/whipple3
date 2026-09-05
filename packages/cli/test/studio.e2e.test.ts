import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { request } from "node:http";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const bin = fileURLToPath(new URL("../dist/main.js", import.meta.url));
/** Fixed and uncommon: this suite owns at most one studio process at a time. */
const PORT = 41771;

const children: ChildProcessWithoutNullStreams[] = [];
afterAll(() => {
  for (const c of children) c.kill("SIGKILL");
});

/** Raw request: fetch() normalises `..` away client-side, which would fake the guard passing. */
const rawGet = (path: string): Promise<{ status: number; type: string }> =>
  new Promise((resolve, reject) => {
    const req = request({ host: "localhost", port: PORT, path }, (res) => {
      res.resume();
      resolve({ status: res.statusCode ?? 0, type: String(res.headers["content-type"] ?? "") });
    });
    req.on("error", reject);
    req.end();
  });

const runToExit = (...argv: string[]): Promise<{ code: number | null; stderr: string }> =>
  new Promise((resolve) => {
    const child = spawn("node", [bin, ...argv]);
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("close", (code) => resolve({ code, stderr }));
  });

describe("whipple3 studio — the live graph, served from the bin", () => {
  it("--demo serves the page and streams real records with no board and no agents", async () => {
    const child = spawn("node", [bin, "studio", "--demo", "--no-open", "--port", String(PORT)]);
    children.push(child);
    child.stdout.setEncoding("utf8");
    await new Promise<void>((resolve, reject) => {
      child.stdout.on("data", (chunk: string) => {
        if (chunk.includes(`http://localhost:${PORT}`)) resolve();
      });
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => reject(new Error(chunk)));
      setTimeout(() => reject(new Error("studio did not announce its url")), 10_000);
    });

    const page = await rawGet("/");
    expect(page.status).toBe(200);
    expect(page.type).toContain("text/html");

    // The demo's whole point: a stranger sees mutations without wiring anything.
    const events = await fetch(`http://localhost:${PORT}/events`, {
      signal: AbortSignal.timeout(4000),
    });
    const reader = events.body?.getReader();
    if (reader === undefined) throw new Error("no SSE body");
    let seen = "";
    while (!seen.includes("ADD_NODE")) {
      const { value, done } = await reader.read();
      if (done) break;
      seen += new TextDecoder().decode(value);
    }
    await reader.cancel();
    expect(seen).toContain("event: record");
    expect(seen).toContain("ADD_NODE");
  });

  it("refuses to walk out of the asset directory", async () => {
    expect((await rawGet("/../main.js")).status).toBe(404);
    expect((await rawGet("/%2e%2e/main.js")).status).toBe(404);
  });

  it("a missing log is a named failure at the process edge, not a blank server", async () => {
    const { code, stderr } = await runToExit("studio", "/nonexistent/session.ndjson", "--no-open");
    expect(code).toBe(1);
    expect(stderr).toMatch(/no such log/);
  });

  it("demands exactly one source among <log>, --demo and --session", async () => {
    const expected = /pass exactly one of <log>, --demo, --session/;

    const neither = await runToExit("studio", "--no-open");
    expect(neither.code).toBe(1);
    expect(neither.stderr).toMatch(expected);

    const both = await runToExit("studio", "some.ndjson", "--demo", "--no-open");
    expect(both.code).toBe(1);
    expect(both.stderr).toMatch(expected);

    const three = await runToExit("studio", "--demo", "--session", "x.jsonl", "--no-open");
    expect(three.code).toBe(1);
    expect(three.stderr).toMatch(expected);
  });

  it("a missing transcript is named, not silently projected as empty", async () => {
    const { code, stderr } = await runToExit(
      "studio",
      "--session",
      "/nonexistent/session.jsonl",
      "--no-open",
    );
    expect(code).toBe(1);
    expect(stderr).toMatch(/no such transcript/);
  });
});
