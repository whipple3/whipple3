import type { RemoteAgentConnection } from "@whipple3/transport-uds";
import { defineCommand } from "citty";
import {
  connectOrExit,
  ensureFile,
  exitFor,
  fileNodeId,
  type Outcome,
  parsePrNumber,
  prArgs,
  prNodeId,
} from "./files.js";
import { COMMENT_LABEL } from "./review-gate.js";

const SEVERITIES = ["blocking", "nit"] as const;
const STATUSES = ["addressed", "wontfix"] as const;

/** A comment id a reviewer can say aloud: `comment:<pr>:<slug of the body>`. */
export const commentSlug = (body: string): string =>
  body
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);

const fail = (error: unknown): Outcome => {
  console.error(`whipple3 comment: ${JSON.stringify(error)}`);
  return "error";
};

const link = async (
  board: RemoteAgentConnection,
  label: string,
  from: string,
  to: string,
): Promise<Outcome> => {
  const edge = await board.post({
    mutation: { kind: "ADD_EDGE", id: `${label}:${from}`, label, from, to },
  });
  return edge.ok || edge.error.code === "EDGE_EXISTS" ? "ok" : fail(edge.error);
};

interface NewComment {
  readonly n: number;
  readonly path: string;
  readonly line: number | null;
  readonly body: string;
  readonly severity: (typeof SEVERITIES)[number];
}

const postComment = async (board: RemoteAgentConnection, c: NewComment): Promise<Outcome> => {
  const id = `comment:${c.n}:${commentSlug(c.body)}`;
  if (!(await ensureFile(board, c.path))) return "error";
  const props = {
    pr: c.n,
    path: c.path,
    line: c.line,
    body: c.body,
    severity: c.severity,
    status: "open",
  };
  const added = await board.post({
    mutation: { kind: "ADD_NODE", id, label: COMMENT_LABEL, props },
  });
  if (!added.ok) return fail(added.error);
  const partOf = await link(board, "part_of", id, prNodeId(c.n));
  if (partOf !== "ok") return partOf;
  const onFile = await link(board, "comments_on", id, fileNodeId(c.path));
  if (onFile !== "ok") return onFile;
  console.log(id);
  return "ok";
};

const setStatus = async (
  board: RemoteAgentConnection,
  id: string,
  status: (typeof STATUSES)[number],
): Promise<Outcome> => {
  const seen = await board.read({ root: id });
  const node = seen.ok ? seen.value.nodes.find((x) => x.id === id) : undefined;
  if (node === undefined) return fail({ code: "NODE_NOT_FOUND", id });
  const updated = await board.post({
    mutation: {
      kind: "UPDATE_NODE",
      id,
      expectedVersion: node.version,
      props: { ...node.props, status },
    },
  });
  if (!updated.ok) return fail(updated.error);
  console.log(`${status} ${id}`);
  return "ok";
};

const statusCommand = (status: (typeof STATUSES)[number]) =>
  defineCommand({
    meta: { name: status, description: `Mark review comments ${status} as the branch identity.` },
    args: prArgs,
    async run({ args }) {
      const board = await connectOrExit(args);
      if (board === null) return;
      const outcomes: Outcome[] = [];
      for (const id of args._) outcomes.push(await setStatus(board, id, status));
      board.close();
      process.exitCode = exitFor(outcomes);
    },
  });

const parseLine = (raw: string | undefined): number | null | undefined => {
  if (raw === undefined) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : undefined;
};

const post = defineCommand({
  meta: { name: "post", description: "Post a review comment: the body is the positional text." },
  args: {
    ...prArgs,
    path: {
      type: "string",
      description: "Repo-relative path the comment is about.",
      required: true,
    },
    line: { type: "string", description: "Line number (optional)." },
    severity: { type: "string", description: "blocking | nit", default: "nit" },
  },
  async run({ args }) {
    const n = parsePrNumber(args.number);
    const line = parseLine(args.line);
    const severity = SEVERITIES.find((s) => s === args.severity);
    const body = args._.join(" ").trim();
    if (n === null || line === undefined || severity === undefined || body === "") {
      console.error(
        "whipple3 comment post: need --number, --path, a body, optional --line, --severity blocking|nit",
      );
      process.exitCode = 1;
      return;
    }
    const board = await connectOrExit(args);
    if (board === null) return;
    const outcome = await postComment(board, { n, path: args.path, line, body, severity });
    board.close();
    process.exitCode = exitFor([outcome]);
  },
});

export const comment = defineCommand({
  meta: {
    name: "comment",
    description: "Review comments on a pull request: post, addressed, wontfix.",
  },
  subCommands: { post, addressed: statusCommand("addressed"), wontfix: statusCommand("wontfix") },
});
