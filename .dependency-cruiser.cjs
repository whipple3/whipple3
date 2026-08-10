/** Import-direction rules: core depends on nothing internal; adapters depend on core, never the reverse. */
module.exports = {
  forbidden: [
    {
      name: "core-stays-pure",
      severity: "error",
      comment: "@arai/core must not import from any other package (functional core).",
      from: { path: "^packages/core" },
      to: { path: "^packages/(log|transport-mcp|studio|cli)" }
    },
    {
      name: "no-node-in-core",
      severity: "error",
      comment: "@arai/core is pure: no Node built-ins (I/O lives in the shell).",
      from: { path: "^packages/core/src" },
      to: { path: "^node:" }
    }
  ],
  options: { doNotFollow: { path: "node_modules" }, tsConfig: { fileName: "tsconfig.base.json" } }
};
