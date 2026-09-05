import { CLAIM_TTL_MAX_MS } from "@whipple3/transport-mcp";
import { defineCommand } from "citty";
import { FILE_LABEL, fileArgs, fileNodeId, withBoard } from "./files.js";

/**
 * A claim a shell can make — the enforcement point a PreToolUse hook needs. The File
 * node is created on first sight, so a wave never has to pre-register its paths; the
 * reducer decides the rest, and names the true holder when it refuses.
 */
export const claim = defineCommand({
  meta: { name: "claim", description: "Claim file paths on a board as one identity." },
  args: {
    ...fileArgs,
    ttl: {
      type: "string",
      description: "Claim lifetime in seconds (renew by claiming again).",
      default: String(CLAIM_TTL_MAX_MS / 1000),
    },
  },
  async run({ args }) {
    const ttlMs = Number(args.ttl) * 1000;
    await withBoard(args, async (board, path) => {
      const id = fileNodeId(path);
      const added = await board.post({
        mutation: { kind: "ADD_NODE", id, label: FILE_LABEL, props: { path } },
      });
      if (!added.ok && added.error.code !== "NODE_EXISTS") {
        console.error(`whipple3 claim: ${path}: ${JSON.stringify(added.error)}`);
        return "error";
      }
      const taken = await board.claim({ id, ttlMs });
      if (taken.ok) {
        console.log(`claimed ${path}`);
        return "ok";
      }
      if (taken.error.code === "ALREADY_CLAIMED") {
        console.log(`held ${path} by ${taken.error.holder}`);
        return "held";
      }
      console.error(`whipple3 claim: ${path}: ${JSON.stringify(taken.error)}`);
      return "error";
    });
  },
});
