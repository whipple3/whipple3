// whipple3 HITL gate (SPEC §4.6): every file write by the fixer subagent escalates to an
// interactive permission prompt — even in sessions that auto-accept edits. PreToolUse
// input carries `agent_type` (the subagent's `name`) when a subagent is running; anyone
// other than the fixer gets no opinion from this hook and flows through normal permissions.
let raw = "";
process.stdin.on("data", (chunk) => {
  raw += chunk;
});
process.stdin.on("end", () => {
  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    process.exit(0); // unparseable input: no opinion, never block the session
  }
  if (input.agent_type !== "whipple3-fixer") process.exit(0);
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "ask",
        permissionDecisionReason:
          "whipple3 HITL gate: the fixer never writes a file without human approval.",
      },
    }),
  );
  process.exit(0);
});
