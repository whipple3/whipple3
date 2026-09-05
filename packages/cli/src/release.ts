import { defineCommand } from "citty";
import { fileArgs, fileNodeId, withBoard } from "./files.js";

/** The other half of `claim`: a wave that merged (or died) hands its paths back. */
export const release = defineCommand({
  meta: { name: "release", description: "Release file paths you hold on a board." },
  args: fileArgs,
  async run({ args }) {
    await withBoard(args, async (board, path) => {
      const freed = await board.release({ id: fileNodeId(path) });
      if (freed.ok) {
        console.log(`released ${path}`);
        return "ok";
      }
      if (freed.error.code === "CLAIM_NOT_HELD" || freed.error.code === "NODE_NOT_FOUND") {
        console.log(`not held ${path}`);
        return "held";
      }
      console.error(`whipple3 release: ${path}: ${JSON.stringify(freed.error)}`);
      return "error";
    });
  },
});
