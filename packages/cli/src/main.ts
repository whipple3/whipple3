#!/usr/bin/env node
import { mkdirSync } from "node:fs";
import { createJsonlLog } from "@arai/log";
import { createSession, liveSessionDeps, serveStdio } from "@arai/transport-mcp";
import { defineCommand, runMain } from "citty";

const stub = (name: string) =>
  defineCommand({
    meta: { name, description: `${name} (W1/W2 — see SPEC.md §12)` },
    run() {
      console.log(`arai ${name}: not implemented in the skeleton yet — see SPEC.md §12.`);
    },
  });

const mcp = defineCommand({
  meta: { name: "mcp", description: "Start the arai blackboard MCP server on stdio." },
  async run() {
    mkdirSync(".arai", { recursive: true });
    const stamp = new Date().toISOString().replaceAll(":", "-");
    const session = createSession({
      log: createJsonlLog(`.arai/session-${stamp}.ndjson`),
      // v0.1: the host's tool allowlist is the gate; schema-level ACL config arrives with the plugin demo.
      acl: null,
      ...liveSessionDeps(),
    });
    // stdout is the MCP wire from here on — nothing else may print to it.
    await serveStdio(session);
  },
});

const main = defineCommand({
  meta: {
    name: "arai",
    version: "0.0.0",
    description: "arai — a typed, ephemeral, event-sourced blackboard for coordinating AI agents.",
  },
  subCommands: {
    init: stub("init"),
    mcp,
    studio: stub("studio"),
    replay: stub("replay"),
  },
});

runMain(main);
