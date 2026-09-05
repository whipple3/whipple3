import { type AgentId, agentId } from "@whipple3/core";
import { connectBoard, type RemoteAgentConnection } from "@whipple3/transport-uds";

/** The one id scheme `claim`, `release` and `pr` share: a repo-relative path names its File node. */
export const fileNodeId = (path: string): string => `file:${path}`;
export const FILE_LABEL = "File";

export const PR_LABEL = "PullRequest";
export const TOUCHES_LABEL = "touches";
export const prNodeId = (n: number): string => `pr:${n}`;
export const touchesEdgeId = (n: number, path: string): string =>
  `${TOUCHES_LABEL}:${prNodeId(n)}:${fileNodeId(path)}`;

export interface FileCommandArgs {
  readonly board: string;
  readonly agent: string;
  readonly _: readonly string[];
}

/** Shared arg table — identity is explicit here because a shell has no socket of its own. */
export const fileArgs = {
  board: {
    type: "string",
    description: "Socket path of the board.",
    default: ".whipple3/board.sock",
  },
  agent: {
    type: "string",
    description: "Identity to act as (in a wave: the branch name).",
    required: true,
  },
} as const;

export const prArgs = {
  ...fileArgs,
  number: { type: "string", description: "Pull request number.", required: true },
  url: { type: "string", description: "Pull request URL (recorded, never fetched)." },
} as const;

/** A PR number the forge would accept; anything else is exit 1 before the board is dialed. */
export const parsePrNumber = (raw: string): number | null => {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
};

/**
 * Per-path outcome → exit code. `held` is the one result a caller branches on, so it owns
 * its own code (2) — distinct from a board that could not be reached at all (1).
 */
export type Outcome = "ok" | "held" | "error";

export const exitFor = (outcomes: readonly Outcome[]): number => {
  if (outcomes.includes("error")) return 1;
  if (outcomes.includes("held")) return 2;
  return 0;
};

/** Dial the board as one identity, or explain on stderr and set exit 1. Never a silent pass. */
export const connectOrExit = async (
  args: Pick<FileCommandArgs, "board" | "agent">,
): Promise<RemoteAgentConnection | null> => {
  try {
    return await connectBoard({ socketPath: args.board, agentId: agentId(args.agent) });
  } catch (e) {
    console.error(`whipple3: ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
    return null;
  }
};

export const withBoard = async (
  args: FileCommandArgs,
  each: (board: RemoteAgentConnection, path: string, agent: AgentId) => Promise<Outcome>,
  before?: (board: RemoteAgentConnection) => Promise<Outcome>,
): Promise<void> => {
  const board = await connectOrExit(args);
  if (board === null) return;
  const outcomes: Outcome[] = [];
  if (before !== undefined) outcomes.push(await before(board));
  if (!outcomes.includes("error"))
    for (const path of args._) outcomes.push(await each(board, path, agentId(args.agent)));
  board.close();
  process.exitCode = exitFor(outcomes);
};

/** The File node is created on first sight, so a wave never has to pre-register its paths. */
export const ensureFile = async (board: RemoteAgentConnection, path: string): Promise<boolean> => {
  const added = await board.post({
    mutation: { kind: "ADD_NODE", id: fileNodeId(path), label: FILE_LABEL, props: { path } },
  });
  if (added.ok || added.error.code === "NODE_EXISTS") return true;
  console.error(`whipple3: ${path}: ${JSON.stringify(added.error)}`);
  return false;
};

/** Claim one path; the reducer decides, and names the true holder when it refuses. */
export const claimPath = async (
  board: RemoteAgentConnection,
  path: string,
  ttlMs: number,
): Promise<Outcome> => {
  if (!(await ensureFile(board, path))) return "error";
  const taken = await board.claim({ id: fileNodeId(path), ttlMs });
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
};
