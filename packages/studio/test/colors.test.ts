import { describe, expect, it } from "vitest";
import { colorForAgent, colorForLabel } from "../src/colors.js";

const HEX = /^#[0-9a-f]{6}$/i;

describe("colorForLabel", () => {
  it("is a stable hex color per label", () => {
    expect(colorForLabel("file")).toMatch(HEX);
    expect(colorForLabel("file")).toBe(colorForLabel("file"));
  });

  it("separates the demo labels", () => {
    expect(colorForLabel("file")).not.toBe(colorForLabel("finding"));
  });
});

describe("colorForAgent", () => {
  it("is a stable hex color per agent", () => {
    expect(colorForAgent("auditor-1")).toMatch(HEX);
    expect(colorForAgent("auditor-1")).toBe(colorForAgent("auditor-1"));
  });

  it("separates the demo agents", () => {
    const agents = ["scanner", "auditor-1", "auditor-2", "fixer"];
    const colors = new Set(agents.map(colorForAgent));
    expect(colors.size).toBe(agents.length);
  });

  it("never collides with label colors — a tint must read as a tint", () => {
    const labels = ["file", "finding", "patch"].map(colorForLabel);
    for (const agent of ["scanner", "auditor-1", "auditor-2", "fixer"])
      expect(labels).not.toContain(colorForAgent(agent));
  });
});
