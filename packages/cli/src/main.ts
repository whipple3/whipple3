#!/usr/bin/env node
import { defineCommand, runMain } from "citty";
import { distill } from "./distill.js";
import { mcp } from "./mcp.js";
import { ping } from "./ping.js";
import { serve } from "./serve.js";
import { VERSION } from "./version.js";

/** Registry only — one command per file. FROZEN mid-wave; commands own their own files. */
const stub = (name: string) =>
  defineCommand({
    meta: { name, description: `${name} (see ROADMAP.md)` },
    run() {
      console.log(`whipple3 ${name}: not implemented yet — see ROADMAP.md.`);
    },
  });

const main = defineCommand({
  meta: {
    name: "whipple3",
    version: VERSION,
    description:
      "whipple3 — a typed, ephemeral, event-sourced blackboard for coordinating AI agents.",
  },
  subCommands: {
    init: stub("init"),
    mcp,
    serve,
    ping,
    distill,
    studio: stub("studio"),
    replay: stub("replay"),
  },
});

runMain(main);
