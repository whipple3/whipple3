/** Import-direction rules: core depends on nothing internal; adapters depend on core, never the reverse. */
module.exports = {
  forbidden: [
    {
      name: "core-stays-pure",
      severity: "error",
      comment: "@whipple3/core must not import from any other package (functional core).",
      from: { path: "^packages/core" },
      to: { path: "^packages/(log|transport-mcp|transport-uds|studio|cli)" }
    },
    {
      name: "only-cli-uses-transport-uds",
      severity: "error",
      comment: "@whipple3/transport-uds is consumed by the cli only (W2-B import direction).",
      from: { path: "^packages/(core|log|transport-mcp|studio)" },
      to: { path: "^packages/transport-uds" }
    },
    {
      name: "transport-uds-import-direction",
      severity: "error",
      comment: "@whipple3/transport-uds may depend on core/log/transport-mcp, never on studio or cli.",
      from: { path: "^packages/transport-uds" },
      to: { path: "^packages/(studio|cli)" }
    },
    {
      name: "no-node-in-core",
      severity: "error",
      comment: "@whipple3/core is pure: no Node built-ins (I/O lives in the shell).",
      from: { path: "^packages/core/src" },
      to: { path: "^node:" }
    }
  ],
  options: { doNotFollow: { path: "node_modules" }, tsConfig: { fileName: "tsconfig.base.json" } }
};
