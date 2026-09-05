import { spawnSync } from "node:child_process";
import { agentId } from "@whipple3/core";
import { defineCommand } from "citty";
import { connectOrExit, exitFor, type Outcome, parsePrNumber, prArgs } from "./files.js";
import { checkPr, mergedPr } from "./pr.js";

/** The forge is whatever follows `--`; GitHub's CLI by default, Origin's when it has one. */
const forgeCommand = (rest: readonly string[], n: number): readonly string[] =>
  rest.length > 0 ? rest : ["gh", "pr", "merge", String(n)];

const runForge = (argv: readonly string[]): Outcome => {
  const [cmd, ...args] = argv;
  if (cmd === undefined) return "error";
  const r = spawnSync(cmd, args, { stdio: "inherit" });
  if (r.status === 0) return "ok";
  console.error(`whipple3 merge: forge command failed (${argv.join(" ")}) — claims left held`);
  return "error";
};

/**
 * Fail closed: an unreachable board is exit 1, never a merge. Each step returns before
 * the next one runs, so a refused gate never reaches the forge and a failed forge never
 * releases a claim.
 */
export const merge = defineCommand({
  meta: {
    name: "merge",
    description: "Check the board, run the forge's merge, then release the PR's paths.",
  },
  args: prArgs,
  async run({ args }) {
    const n = parsePrNumber(args.number);
    if (n === null) {
      console.error(`whipple3 merge: --number must be a positive integer`);
      process.exitCode = 1;
      return;
    }
    const board = await connectOrExit(args);
    if (board === null) return;
    const outcome = await gate(board, n, args.agent, args._);
    board.close();
    process.exitCode = exitFor([outcome]);
  },
});

const gate = async (
  board: Parameters<typeof checkPr>[0],
  n: number,
  branch: string,
  rest: readonly string[],
): Promise<Outcome> => {
  const checked = await checkPr(board, n, agentId(branch));
  if (checked !== "ok") return checked;
  const forged = runForge(forgeCommand(rest, n));
  if (forged !== "ok") return forged;
  return mergedPr(board, n);
};
