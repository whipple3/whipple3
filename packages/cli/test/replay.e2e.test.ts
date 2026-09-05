import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { runFixture } from "@whipple3/studio";
import { beforeAll, describe, expect, it } from "vitest";

const bin = fileURLToPath(new URL("../dist/main.js", import.meta.url));
const run = promisify(execFile);

/** execFile rejects on a non-zero exit; the code and the streams are on the error. */
const cli = async (...argv: string[]): Promise<{ code: number; out: string; err: string }> => {
  try {
    const { stdout, stderr } = await run("node", [bin, ...argv]);
    return { code: 0, out: stdout, err: stderr };
  } catch (e) {
    const fail = e as { code?: number; stdout?: string; stderr?: string };
    return { code: fail.code ?? 1, out: fail.stdout ?? "", err: fail.stderr ?? "" };
  }
};

describe("whipple3 replay — the log must reproduce its own history", () => {
  let log = "";

  beforeAll(async () => {
    log = join(mkdtempSync(join(tmpdir(), "whipple3-replay-")), "session.ndjson");
    await runFixture(log, 0); // stepMs 0: the same script the Studio demo runs, unpaced
  }, 30_000);

  it("folds a real session clean and says so", async () => {
    const { code, out } = await cli("replay", log);
    expect(code).toBe(0);
    expect(out).toContain("— OK");
    // The fixture ends with one claim deliberately still held; replay reports, never judges it.
    expect(out).toMatch(/claims held at end 1/);
  });

  it("--json is machine-readable for a CI gate", async () => {
    const { code, out } = await cli("replay", log, "--json");
    expect(code).toBe(0);
    const verdict: unknown = JSON.parse(out);
    expect(verdict).toMatchObject({ ok: true, violations: [] });
  });

  it("fails the build on a spliced log instead of folding around the hole", async () => {
    const spliced = `${log}.spliced.ndjson`;
    const lines = readFileSync(log, "utf8").trimEnd().split("\n");
    // Trailing newline required: the jsonl reader treats an unterminated last line as a
    // torn write and skips it — correct crash recovery, and a silent way to write a test
    // whose final record never reaches the assertion.
    writeFileSync(spliced, `${[...lines.slice(0, 4), ...lines.slice(5)].join("\n")}\n`, "utf8");

    const { code, err } = await cli("replay", spliced);
    expect(code).toBe(1);
    expect(err).toMatch(/seq is not contiguous/);
  });

  it("a lease takeover after expiry is legal, not a collision", async () => {
    // Regression: an earlier cut read the claim.* taxonomy, which carries no expiry and
    // never emits claim.expired — so every legitimate takeover was reported as a duplicate.
    const record = (seq: number, mutation: unknown) => ({
      seq,
      meta: {
        txId: `tx-${seq}`,
        sessionId: "lease-test",
        agentId: null,
        principal: null,
        ts: seq,
        causationId: null,
        correlationId: "tx-0",
      },
      event: { type: "graph.mutation", mutation },
    });
    const takeover = `${log}.takeover.ndjson`;
    writeFileSync(
      takeover,
      `${[
        record(0, { kind: "ADD_NODE", id: "n1", label: "file", props: {} }),
        record(1, { kind: "CLAIM_NODE", id: "n1", agentId: "a", now: 0, ttlMs: 1000 }),
        // b takes over 4s after a's one-second lease lapsed — exactly what apply() permits
        record(2, { kind: "CLAIM_NODE", id: "n1", agentId: "b", now: 5000, ttlMs: 1000 }),
      ]
        .map((r) => JSON.stringify(r))
        .join("\n")}\n`,
      "utf8",
    );

    const { code, out } = await cli("replay", takeover, "--json");
    expect(code).toBe(0);
    expect(out).toContain('"violations":[]');
  });

  it("a live claim taken by a second agent IS a violation", async () => {
    const record = (seq: number, mutation: unknown) => ({
      seq,
      meta: {
        txId: `tx-${seq}`,
        sessionId: "collision-test",
        agentId: null,
        principal: null,
        ts: seq,
        causationId: null,
        correlationId: "tx-0",
      },
      event: { type: "graph.mutation", mutation },
    });
    const collision = `${log}.collision.ndjson`;
    writeFileSync(
      collision,
      `${[
        record(0, { kind: "ADD_NODE", id: "n1", label: "file", props: {} }),
        record(1, { kind: "CLAIM_NODE", id: "n1", agentId: "a", now: 0, ttlMs: 60_000 }),
        record(2, { kind: "CLAIM_NODE", id: "n1", agentId: "b", now: 1000, ttlMs: 60_000 }),
      ]
        .map((r) => JSON.stringify(r))
        .join("\n")}\n`,
      "utf8",
    );

    const { code, err } = await cli("replay", collision);
    expect(code).toBe(1);
    expect(err).toMatch(/duplicate claim on n1: b over live a/);
  });

  it("a missing log is a named failure, not an empty pass", async () => {
    const { code, err } = await cli("replay", "/nonexistent/session.ndjson");
    expect(code).toBe(1);
    expect(err).toMatch(/no such log/);
  });
});
