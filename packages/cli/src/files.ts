import { type AgentId, agentId } from "@whipple3/core";
import { connectBoard, type RemoteAgentConnection } from "@whipple3/transport-uds";

/** The one id scheme `claim` and `release` share: a repo-relative path names its File node. */
export const fileNodeId = (path: string): string => `file:${path}`;
export const FILE_LABEL = "File";

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

export const withBoard = async (
  args: FileCommandArgs,
  each: (board: RemoteAgentConnection, path: string, agent: AgentId) => Promise<Outcome>,
): Promise<void> => {
  const me = agentId(args.agent);
  let board: RemoteAgentConnection;
  try {
    board = await connectBoard({ socketPath: args.board, agentId: me });
  } catch (e) {
    console.error(`whipple3: ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
    return;
  }
  const outcomes: Outcome[] = [];
  for (const path of args._) outcomes.push(await each(board, path, me));
  board.close();
  process.exitCode = exitFor(outcomes);
};
