/** Import-direction rules: core depends on nothing internal; adapters depend on core, never the reverse. */
module.exports = {
  forbidden: [
    {
      name: "core-stays-pure",
      severity: "error",
      comment: "@whipple3/core must not import from any other package (functional core).",
      from: { path: "^packages/core" },
      to: { path: "^packages/(log|transport-mcp|transport-uds|studio|cli)" },
    },
    {
      name: "only-cli-uses-transport-uds",
      severity: "error",
      comment: "@whipple3/transport-uds is consumed by the cli only (W2-B import direction).",
      from: { path: "^packages/(core|log|transport-mcp|studio)" },
      to: { path: "^packages/transport-uds" },
    },
    {
      name: "transport-uds-import-direction",
      severity: "error",
      comment:
        "@whipple3/transport-uds may depend on core/log/transport-mcp, never on studio or cli.",
      from: { path: "^packages/transport-uds" },
      to: { path: "^packages/(studio|cli)" },
    },
    {
      name: "assert-is-a-leaf",
      severity: "error",
      comment:
        "@whipple3/assert reads a finished log and judges it. It may depend on core and log; " +
        "nothing that produces a session may depend on it — a board that knows its own " +
        "assertions could satisfy them.",
      from: { path: "^packages/assert" },
      to: { path: "^packages/(transport-mcp|transport-uds|studio|cli|transcript)" },
    },
    {
      name: "nothing-produces-against-its-own-judge",
      severity: "error",
      comment: "Only the cli may reach @whipple3/assert; the board never sees it.",
      from: { path: "^packages/(core|log|transport-mcp|transport-uds|studio|transcript)" },
      to: { path: "^packages/assert" },
    },
    {
      name: "transcript-import-direction",
      severity: "error",
      comment:
        "@whipple3/transcript reads a foreign format and projects it onto core. It may depend " +
        "on core and nothing else of ours; nothing in the graph path may depend on it.",
      from: { path: "^packages/transcript" },
      to: { path: "^packages/(log|transport-mcp|transport-uds|studio|cli)" },
    },
    {
      name: "core-stays-clear-of-transcript",
      severity: "error",
      comment: "The board's packages must not learn about Claude Code's on-disk format.",
      from: { path: "^packages/(core|log|transport-mcp|transport-uds|studio)" },
      to: { path: "^packages/transcript" },
    },
    {
      name: "no-node-in-core",
      severity: "error",
      comment: "@whipple3/core is pure: no Node built-ins (I/O lives in the shell).",
      from: { path: "^packages/core/src" },
      // dependencyTypes, not a "^node:" path match: the resolver strips the node:
      // protocol before rules run, so a path rule can never fire. "core" is
      // dependency-cruiser's name for Node built-ins, prefixed or bare.
      to: { dependencyTypes: ["core"] },
    },
  ],
  options: { doNotFollow: { path: "node_modules" }, tsConfig: { fileName: "tsconfig.base.json" } },
};
