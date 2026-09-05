#!/usr/bin/env node
import { defineCommand, runMain } from "citty";
import { claim } from "./claim.js";
import { comment } from "./comment.js";
import { distill } from "./distill.js";
import { mcp } from "./mcp.js";
import { merge } from "./merge.js";
import { ping } from "./ping.js";
import { pr } from "./pr.js";
import { release } from "./release.js";
import { replay } from "./replay.js";
import { review } from "./review.js";
import { serve } from "./serve.js";
import { studio } from "./studio.js";
import { VERSION } from "./version.js";

/**
 * Registry only — one command per file; commands own their own files.
 * Every entry here works. A planned command lives in ROADMAP.md until it does,
 * never as a subcommand that prints "not implemented" into a stranger's `--help`.
 */
const main = defineCommand({
  meta: {
    name: "whipple3",
    version: VERSION,
    description:
      "whipple3 — a typed, ephemeral, event-sourced blackboard for coordinating AI agents.",
  },
  subCommands: {
    mcp,
    serve,
    ping,
    claim,
    release,
    pr,
    merge,
    review,
    comment,
    distill,
    studio,
    replay,
  },
});

runMain(main);
