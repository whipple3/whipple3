import { describe, expect, it } from "vitest";
import { type AclPolicy, checkAcl, checkRead, readableLabels } from "../src/acl.js";
import { agentId, nodeId, version } from "../src/ids.js";
import { apply } from "../src/mutation.js";
import { emptyState, type GraphState } from "../src/state.js";

const policy: AclPolicy = {
  scanner: { write: ["CodeFile"], read: ["CodeFile"] },
  auditor: {
    write: ["SecurityIssue", "HAS_ISSUE"],
    read: ["CodeFile", "SecurityIssue", "HAS_ISSUE"],
  },
};

const addCodeFile = {
  kind: "ADD_NODE",
  id: nodeId("f1"),
  label: "CodeFile",
  props: {},
} as const;

describe("ACL — write side (canMutate, SPEC §4.6)", () => {
  it("allows labels in the agent's write list and denies others with ACL_DENIED_WRITE", () => {
    expect(checkAcl(policy, agentId("scanner"), addCodeFile, emptyState()).ok).toBe(true);
    const denied = checkAcl(policy, agentId("auditor"), addCodeFile, emptyState());
    expect(denied.ok).toBe(false);
    if (!denied.ok) {
      expect(denied.error.code).toBe("ACL_DENIED_WRITE");
      expect(denied.error.label).toBe("CodeFile");
    }
  });

  it("a read-only label grants no write access", () => {
    const denied = checkAcl(policy, agentId("auditor"), addCodeFile, emptyState());
    expect(denied.ok).toBe(false);
  });
});

describe("ACL — write side resolves the label from STATE for existing-node mutations", () => {
  // auditor may READ CodeFile but not write it — the sharp edge each case must hold:
  // read access alone must never allow updating, locking, or releasing a node.
  const seeded: GraphState = (() => {
    const r = apply(emptyState(), addCodeFile);
    if (!r.ok) throw new Error("seed failed");
    return r.value;
  })();

  it("UPDATE_NODE outside the write list is ACL_DENIED_WRITE with the node's label", () => {
    const update = {
      kind: "UPDATE_NODE",
      id: nodeId("f1"),
      expectedVersion: version(1),
      props: { status: "x" },
    } as const;
    expect(checkAcl(policy, agentId("scanner"), update, seeded).ok).toBe(true);
    const denied = checkAcl(policy, agentId("auditor"), update, seeded);
    expect(denied.ok).toBe(false);
    if (!denied.ok) {
      expect(denied.error.code).toBe("ACL_DENIED_WRITE");
      expect(denied.error.label).toBe("CodeFile");
    }
  });

  it("CLAIM_NODE is a write — a read-only agent cannot lock arbitrary nodes", () => {
    const claim = {
      kind: "CLAIM_NODE",
      id: nodeId("f1"),
      agentId: agentId("auditor"),
      now: 0,
      ttlMs: 1000,
    } as const;
    expect(checkAcl(policy, agentId("scanner"), claim, seeded).ok).toBe(true);
    const denied = checkAcl(policy, agentId("auditor"), claim, seeded);
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.error.code).toBe("ACL_DENIED_WRITE");
  });

  it("RELEASE_NODE is a write — same gate as the claim it undoes", () => {
    const release = {
      kind: "RELEASE_NODE",
      id: nodeId("f1"),
      agentId: agentId("auditor"),
    } as const;
    expect(checkAcl(policy, agentId("scanner"), release, seeded).ok).toBe(true);
    const denied = checkAcl(policy, agentId("auditor"), release, seeded);
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.error.code).toBe("ACL_DENIED_WRITE");
  });
});

describe("ACL — read side (SPEC §4.6)", () => {
  it("checkRead denies labels outside the agent's read list with ACL_DENIED_READ", () => {
    expect(checkRead(policy, agentId("auditor"), "SecurityIssue").ok).toBe(true);
    const denied = checkRead(policy, agentId("scanner"), "SecurityIssue");
    expect(denied.ok).toBe(false);
    if (!denied.ok) {
      expect(denied.error.code).toBe("ACL_DENIED_READ");
      expect(denied.error.agentId).toBe("scanner");
      expect(denied.error.label).toBe("SecurityIssue");
    }
  });

  it("an agent absent from the policy can read nothing", () => {
    expect(checkRead(policy, agentId("stranger"), "CodeFile").ok).toBe(false);
  });

  it("readableLabels exposes the agent's read list for slice filtering", () => {
    expect(readableLabels(policy, agentId("scanner"))).toEqual(["CodeFile"]);
    expect(readableLabels(policy, agentId("stranger"))).toEqual([]);
  });
});
