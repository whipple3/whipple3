import { describe, expect, it } from "vitest";
import { parsePolicy } from "../src/policy.js";

describe("policy file — the boundary where central policy enters a session (SPEC §4.6)", () => {
  it("parses acl + slices into session-ready config", () => {
    const r = parsePolicy({
      acl: {
        scanner: { write: ["CodeFile"], read: ["CodeFile"] },
        fixer: { write: [], read: ["CodeFile", "SecurityIssue", "HAS_ISSUE"] },
      },
      slices: {
        fixer: {
          kind: "slice",
          root: "CodeFile",
          follow: [{ edge: "HAS_ISSUE", from: "CodeFile", to: "SecurityIssue", hops: 1, next: [] }],
        },
      },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.acl?.scanner?.write).toEqual(["CodeFile"]);
      expect(r.value.slices?.fixer?.root).toBe("CodeFile");
    }
  });

  it("an acl-only file leaves slices undefined; an empty object is a valid no-op policy", () => {
    const aclOnly = parsePolicy({ acl: { a: { write: [], read: [] } } });
    expect(aclOnly.ok && aclOnly.value.slices === undefined).toBe(true);
    expect(parsePolicy({}).ok).toBe(true);
  });

  it("malformed policy is a PARSE_ERROR value naming the path, never a throw", () => {
    const r = parsePolicy({
      acl: { scanner: { write: "CodeFile", read: [] } },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("PARSE_ERROR");
      expect(r.error.issues.some((i) => i.path.includes("scanner"))).toBe(true);
    }
  });

  it("nested follow rules survive the recursive schema", () => {
    const r = parsePolicy({
      slices: {
        fixer: {
          kind: "slice",
          root: "CodeFile",
          follow: [
            {
              edge: "HAS_ISSUE",
              from: "CodeFile",
              to: "SecurityIssue",
              hops: 1,
              next: [{ edge: "FIXED_BY", from: "SecurityIssue", to: "Fix", hops: 2, next: [] }],
            },
          ],
        },
      },
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.slices?.fixer?.follow[0]?.next[0]?.hops).toBe(2);
  });
});
