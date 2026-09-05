import type { AgentId, NodeId, NodeRecord, Slice } from "@whipple3/core";
import { agentId } from "@whipple3/core";
import { CLAIM_TTL_MAX_MS } from "@whipple3/transport-mcp";
import type { RemoteAgentConnection } from "@whipple3/transport-uds";
import { defineCommand } from "citty";
import {
  claimPath,
  connectOrExit,
  ensureFile,
  exitFor,
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
import { reviewGate } from "./review-gate.js";

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

/** The PR node and its readable neighborhood — null (and exit 1) when the board has no such PR. */
const readPr = async (
  board: RemoteAgentConnection,
  n: number,
): Promise<{ node: NodeRecord; slice: Slice } | null> => {
  const r = await board.read({ root: prNodeId(n) });
  const node = r.ok ? r.value.nodes.find((x) => x.id === prNodeId(n)) : undefined;
  if (node !== undefined && r.ok) return { node, slice: r.value };
  console.error(`whipple3 pr: no such pr ${n}`);
  process.exitCode = 1;
  return null;
};

const pathOf = (slice: Slice, id: NodeId): string => {
  const node = slice.nodes.find((x) => x.id === id);
  return typeof node?.props.path === "string" ? node.props.path : String(id);
};

/** Live holds by anyone but me. Expired leases are free — the same rule the reducer applies. */
const heldByOthers = (slice: Slice, me: AgentId, now: number): readonly [string, AgentId][] =>
  slice.claims
    .filter((c) => c.expiresAt > now && c.agentId !== me)
    .map((c) => [pathOf(slice, c.nodeId), c.agentId]);

/** The gate itself, callable without a shell: exit-code semantics as an Outcome. */
export const checkPr = async (
  board: RemoteAgentConnection,
  n: number,
  me: AgentId,
): Promise<Outcome> => {
  const found = await readPr(board, n);
  if (found === null) return "error";
  const review = reviewGate(found.slice, n);
  for (const line of review) console.log(line);
  if (review.length > 0) return "held";
  const held = heldByOthers(found.slice, me, Date.now());
  for (const [path, holder] of held) console.log(`held ${path} by ${holder}`);
  if (held.length > 0) return "held";
  console.log("clear");
  return "ok";
};

const touchedPaths = (n: number, slice: Slice): readonly string[] =>
  slice.edges
    .filter((e) => e.label === TOUCHES_LABEL && e.from === prNodeId(n))
    .map((e) => pathOf(slice, e.to));

const releasePath = async (board: RemoteAgentConnection, path: string): Promise<Outcome> => {
  const freed = await board.release({ id: fileNodeId(path) });
  if (freed.ok) {
    console.log(`released ${path}`);
    return "ok";
  }
  if (freed.error.code === "CLAIM_NOT_HELD") {
    console.log(`not held ${path}`);
    return "ok";
  }
  console.error(`whipple3 pr: ${path}: ${JSON.stringify(freed.error)}`);
  return "error";
};

/** State flips first: a version conflict means someone else moved the PR, and we stop. */
export const mergedPr = async (board: RemoteAgentConnection, n: number): Promise<Outcome> => {
  const found = await readPr(board, n);
  if (found === null) return "error";
  const flipped = await board.post({
    mutation: {
      kind: "UPDATE_NODE",
      id: prNodeId(n),
      expectedVersion: found.node.version,
      props: { state: "merged" },
    },
  });
  if (!flipped.ok) {
    console.error(`whipple3 pr: ${JSON.stringify(flipped.error)}`);
    return "error";
  }
  console.log(`pr ${n} merged`);
  const outcomes: Outcome[] = [];
  for (const path of touchedPaths(n, found.slice)) outcomes.push(await releasePath(board, path));
  return outcomes.includes("error") ? "error" : "ok";
};

const withPr = (step: (board: RemoteAgentConnection, n: number, me: AgentId) => Promise<Outcome>) =>
  defineCommand({
    args: prArgs,
    async run({ args }) {
      const n = parsePrNumber(args.number);
      if (n === null) return badNumber(args.number);
      const board = await connectOrExit(args);
      if (board === null) return;
      const outcome = await step(board, n, agentId(args.agent));
      board.close();
      process.exitCode = exitFor([outcome]);
    },
  });

const check = withPr(checkPr);
check.meta = {
  name: "check",
  description: "Exit 0 if every touched path is free or mine, 2 if held.",
};
const merged = withPr((board, n) => mergedPr(board, n));
merged.meta = { name: "merged", description: "Mark the PR merged and release its paths." };

export const pr = defineCommand({
  meta: { name: "pr", description: "Pull requests on the board: open, check, merged." },
  subCommands: { open, check, merged },
});
