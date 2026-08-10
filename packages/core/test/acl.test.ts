import { describe, expect, it } from "vitest";
import { type AclPolicy, checkAcl, checkRead, readableLabels } from "../src/acl.js";
import { agentId, nodeId } from "../src/ids.js";
import { emptyState } from "../src/state.js";

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
