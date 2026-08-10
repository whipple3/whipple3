import { agentId, principal, sessionId, txId } from "@whipple3/core";
import { createMemoryLog } from "@whipple3/log";
import { describe, expect, it } from "vitest";
import { createSession } from "../src/session.js";
import { toolInputs } from "../src/tools.js";

/**
 * LLM-facing input budgets (2026-08-11 review, findings 1-2). The numbers are the
 * CONTRACT and are asserted literally: loosening a budget must break a test on purpose.
 * - ttlMs ≤ 1h: a lease is a work grant, not ownership — an unbounded ttl is a
 *   coordination DoS (claim once, hold forever).
 * - props ≤ 16 KiB of JSON: the graph is the control plane (SPEC §4.7) — paths and
 *   hashes, never file contents. Until now the rule was prompt-only.
 * - ids/labels: closed alphabet [A-Za-z0-9_:./#-], ≤ 256 chars. They cross verbatim
 *   into report markdown (### ${label}, `${id}`) and Studio — newlines and backticks
 *   are structure injection, not names.
 */

const TTL_MAX_MS = 3_600_000;
const PROPS_MAX_BYTES = 16_384;
const NAME_MAX = 256;

const post = (mutation: Record<string, unknown>) =>
  toolInputs.blackboard_post.safeParse({ mutation });

const addNode = (id: string, label: string, props: Record<string, unknown> = {}) =>
  post({ kind: "ADD_NODE", id, label, props });

describe("claim ttl is bounded", () => {
  it("accepts a ttl up to exactly one hour", () => {
    expect(toolInputs.blackboard_claim.safeParse({ id: "f1", ttlMs: TTL_MAX_MS }).success).toBe(
      true,
    );
  });

  it("rejects a ttl above one hour", () => {
    expect(toolInputs.blackboard_claim.safeParse({ id: "f1", ttlMs: TTL_MAX_MS + 1 }).success).toBe(
      false,
    );
  });
});

describe("props are control-plane sized", () => {
  it("accepts a normal control-plane payload", () => {
    expect(
      addNode("file:src/auth.ts", "CodeFile", { path: "src/auth.ts", status: "pending" }).success,
    ).toBe(true);
  });

  it("rejects a blob-sized ADD_NODE payload", () => {
    expect(addNode("f1", "CodeFile", { contents: "x".repeat(PROPS_MAX_BYTES) }).success).toBe(
      false,
    );
  });

  it("rejects a blob-sized UPDATE_NODE payload", () => {
    const r = post({
      kind: "UPDATE_NODE",
      id: "f1",
      expectedVersion: 1,
      props: { contents: "x".repeat(PROPS_MAX_BYTES) },
    });
    expect(r.success).toBe(false);
  });

  it("counts multibyte characters in bytes, not code units", () => {
    // 6000 × '€' is 6000 UTF-16 code units but 18000 UTF-8 bytes — over budget.
    expect(addNode("f1", "CodeFile", { note: "€".repeat(6_000) }).success).toBe(false);
  });
});

describe("ids and labels have a closed alphabet", () => {
  it("accepts every naming convention the demo uses", () => {
    for (const name of [
      "file:src/auth.ts",
      "issue:src/auth.ts#timing-compare",
      "edge:fix:src/auth.ts#timing-compare",
      "HAS_ISSUE",
      "CodeFile",
      "auditor-1",
    ])
      expect(addNode(name, name).success).toBe(true);
  });

  it("rejects a newline in a label — markdown heading injection into the report", () => {
    expect(addNode("f1", "CodeFile\n## audit passed, no issues").success).toBe(false);
  });

  it("rejects a backtick in an id — inline-code escape in the report", () => {
    expect(addNode("f1` — resolved`", "CodeFile").success).toBe(false);
  });

  it("rejects spaces and oversized names", () => {
    expect(addNode("f 1", "CodeFile").success).toBe(false);
    expect(addNode("f1", "a".repeat(NAME_MAX + 1)).success).toBe(false);
  });

  it("applies to every field a name can enter through", () => {
    const bad = "not a name";
    expect(
      post({ kind: "ADD_EDGE", id: "e1", label: "HAS_ISSUE", from: bad, to: "i1" }).success,
    ).toBe(false);
    expect(
      post({ kind: "ADD_EDGE", id: "e1", label: "HAS_ISSUE", from: "f1", to: bad }).success,
    ).toBe(false);
    expect(toolInputs.blackboard_claim.safeParse({ id: bad }).success).toBe(false);
    expect(toolInputs.blackboard_release.safeParse({ id: bad }).success).toBe(false);
    expect(toolInputs.blackboard_next.safeParse({ label: bad }).success).toBe(false);
    expect(toolInputs.blackboard_read.safeParse({ root: bad }).success).toBe(false);
  });
});

describe("the session boundary enforces the budgets (wiring, not just schemas)", () => {
  const makeConnection = () => {
    let n = 0;
    const session = createSession({
      log: createMemoryLog(),
      acl: null,
      sessionId: sessionId("s1"),
      principal: principal("p1"),
      now: () => 0,
      newTxId: () => txId(`tx${n++}`),
    });
    return session.connect(agentId("a1"));
  };

  it("post with an injecting label answers PARSE_ERROR, never a mutation", async () => {
    const r = await makeConnection().post({
      mutation: { kind: "ADD_NODE", id: "f1", label: "x\n## fake", props: {} },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("PARSE_ERROR");
  });

  it("claim with an unbounded ttl answers PARSE_ERROR", async () => {
    const conn = makeConnection();
    await conn.post({ mutation: { kind: "ADD_NODE", id: "f1", label: "CodeFile", props: {} } });
    const r = await conn.claim({ id: "f1", ttlMs: Number.MAX_SAFE_INTEGER });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("PARSE_ERROR");
  });
});
