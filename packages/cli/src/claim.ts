import { CLAIM_TTL_MAX_MS } from "@whipple3/transport-mcp";
import { defineCommand } from "citty";
import { claimPath, fileArgs, withBoard } from "./files.js";

/** A claim a shell can make — the enforcement point a PreToolUse hook needs. */
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
    await withBoard(args, (board, path) => claimPath(board, path, ttlMs));
  },
});
