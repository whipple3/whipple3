#!/usr/bin/env node
import { defineCommand, runMain } from "citty";

const stub = (name: string) =>
  defineCommand({
    meta: { name, description: `${name} (W1/W2 — see SPEC.md §12)` },
    run() {
      console.log(`arai ${name}: not implemented in the skeleton yet — see SPEC.md §12.`);
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
    mcp: stub("mcp"),
    studio: stub("studio"),
    replay: stub("replay"),
  },
});

runMain(main);
