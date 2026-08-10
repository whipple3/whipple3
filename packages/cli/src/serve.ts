import { defineCommand } from "citty";

/** W2-B lands here: one serve process owns the session; mcp becomes a per-agent proxy. */
export const serve = defineCommand({
  meta: {
    name: "serve",
    description: "Start the shared-state board backend (socket per agent). Wave 2 — W2-B.",
  },
  run() {
    console.log("whipple3 serve: not implemented yet — arrives with Wave 2 (W2-B, ADR-005).");
  },
});
