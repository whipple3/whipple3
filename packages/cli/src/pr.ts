import { CLAIM_TTL_MAX_MS } from "@whipple3/transport-mcp";
import type { RemoteAgentConnection } from "@whipple3/transport-uds";
import { defineCommand } from "citty";
import {
  claimPath,
  ensureFile,
  fileNodeId,
  type Outcome,
  PR_LABEL,
  parsePrNumber,
  prArgs,
  prNodeId,
  TOUCHES_LABEL,
  touchesEdgeId,
  withBoard,
} from "./files.js";

const badNumber = (raw: string): void => {
  console.error(`whipple3 pr: --number must be a positive integer, got ${JSON.stringify(raw)}`);
  process.exitCode = 1;
};

/** The PR is a fact worth recording even when its files are held — so it lands first. */
const openPr = async (
  board: RemoteAgentConnection,
  n: number,
  branch: string,
  url: string | undefined,
): Promise<Outcome> => {
  const added = await board.post({
    mutation: {
      kind: "ADD_NODE",
      id: prNodeId(n),
      label: PR_LABEL,
      props: { number: n, branch, url: url ?? null, state: "open" },
    },
  });
  if (!added.ok && added.error.code !== "NODE_EXISTS") {
    console.error(`whipple3 pr: ${JSON.stringify(added.error)}`);
    return "error";
  }
  console.log(`pr ${n} opened`);
  return "ok";
};

const touch = async (board: RemoteAgentConnection, n: number, path: string): Promise<boolean> => {
  if (!(await ensureFile(board, path))) return false;
  const edge = await board.post({
    mutation: {
      kind: "ADD_EDGE",
      id: touchesEdgeId(n, path),
      label: TOUCHES_LABEL,
      from: prNodeId(n),
      to: fileNodeId(path),
    },
  });
  if (edge.ok || edge.error.code === "EDGE_EXISTS") return true;
  console.error(`whipple3 pr: ${path}: ${JSON.stringify(edge.error)}`);
  return false;
};

const open = defineCommand({
  meta: { name: "open", description: "Record a pull request and claim the paths it touches." },
  args: prArgs,
  async run({ args }) {
    const n = parsePrNumber(args.number);
    if (n === null) return badNumber(args.number);
    await withBoard(
      args,
      async (board, path) =>
        (await touch(board, n, path)) ? claimPath(board, path, CLAIM_TTL_MAX_MS) : "error",
      (board) => openPr(board, n, args.agent, args.url),
    );
  },
});

export const pr = defineCommand({
  meta: { name: "pr", description: "Pull requests on the board: open, check, merged." },
  subCommands: { open },
});
