import { describe, expect, it } from "vitest";
import { clientFrame, createLineBuffer, serverFrame } from "../src/frames.js";

describe("client frames — hello then requests (ADR-007 at the socket layer)", () => {
  it("parses a hello frame declaring the connection's one agent identity", () => {
    const r = clientFrame.safeParse({ kind: "hello", v: 1, agentId: "auditor-1" });
    expect(r.success).toBe(true);
    if (r.success && r.data.kind === "hello") expect(r.data.agentId).toBe("auditor-1");
  });

  it("parses a request frame for each of the six AgentConnection ops", () => {
    for (const op of ["post", "claim", "release", "next", "read", "status"]) {
      const r = clientFrame.safeParse({ kind: "req", id: 0, op, input: { any: "thing" } });
      expect(r.success).toBe(true);
    }
  });

  it("accepts a request without input — status needs none", () => {
    expect(clientFrame.safeParse({ kind: "req", id: 5, op: "status" }).success).toBe(true);
  });

  it("rejects an unknown op, a spoofed hello version, and a foreign kind", () => {
    expect(clientFrame.safeParse({ kind: "req", id: 1, op: "purge" }).success).toBe(false);
    expect(clientFrame.safeParse({ kind: "hello", v: 2, agentId: "a" }).success).toBe(false);
    expect(clientFrame.safeParse({ kind: "exec", cmd: "rm" }).success).toBe(false);
  });
});

describe("server frames — ready, correlated responses, structured errors", () => {
  it("parses ready, res (result carried as-is) and err frames", () => {
    expect(serverFrame.safeParse({ kind: "ready" }).success).toBe(true);
    const res = serverFrame.safeParse({ kind: "res", id: 3, result: { ok: true, value: 1 } });
    expect(res.success).toBe(true);
    const err = serverFrame.safeParse({ kind: "err", id: null, error: { code: "BAD_FRAME" } });
    expect(err.success).toBe(true);
  });

  it("rejects an err frame with a prose-only error (structured errors, never prose)", () => {
    expect(serverFrame.safeParse({ kind: "err", id: null, error: "boom" }).success).toBe(false);
  });
});

describe("line buffer — NDJSON framing over an arbitrary chunk stream", () => {
  it("reassembles lines split across chunks and holds the partial tail", () => {
    const push = createLineBuffer();
    expect(push('{"a"')).toEqual([]);
    expect(push(':1}\n{"b":2}\n{"c"')).toEqual(['{"a":1}', '{"b":2}']);
    expect(push(":3}\n")).toEqual(['{"c":3}']);
  });

  it("drops empty lines so a trailing newline never yields a phantom frame", () => {
    const push = createLineBuffer();
    expect(push("\n\n{'x':1}\n\n")).toEqual(["{'x':1}"]);
  });
});
