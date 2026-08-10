import { defineCommand } from "citty";

/** W2-A lands here: distill() → report.md, explicit lifetime-gated purge. (SPEC §4.8) */
export const distill = defineCommand({
  meta: {
    name: "distill",
    description: "Distill a session log into a report; purge per lifetime policy. Wave 2 — W2-A.",
  },
  run() {
    console.log("whipple3 distill: not implemented yet — arrives with Wave 2 (W2-A, SPEC §4.8).");
  },
});
