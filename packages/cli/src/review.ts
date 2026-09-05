import type { RemoteAgentConnection } from "@whipple3/transport-uds";
import { defineCommand } from "citty";
import { connectOrExit, exitFor, type Outcome, parsePrNumber, prArgs, prNodeId } from "./files.js";
import { REVIEW_LABEL } from "./review-gate.js";

const VERDICTS = ["approve", "request_changes"] as const;
type Verdict = (typeof VERDICTS)[number];
const REVIEWS_LABEL = "reviews";

const parseVerdict = (raw: string): Verdict | null => VERDICTS.find((v) => v === raw) ?? null;

export const reviewNodeId = (n: number, reviewer: string): string => `review:${n}:${reviewer}`;

/** One node per reviewer per PR: a changed verdict is an UPDATE, so the log keeps the history. */
const upsertVerdict = async (
  board: RemoteAgentConnection,
  n: number,
  reviewer: string,
  verdict: Verdict,
): Promise<Outcome> => {
  const id = reviewNodeId(n, reviewer);
  const props = { pr: n, reviewer, verdict };
  const added = await board.post({
    mutation: { kind: "ADD_NODE", id, label: REVIEW_LABEL, props },
  });
  if (added.ok) return linkReview(board, n, id);
  if (added.error.code !== "NODE_EXISTS") return fail(added.error);
  const seen = await board.read({ root: id });
  const node = seen.ok ? seen.value.nodes.find((x) => x.id === id) : undefined;
  if (node === undefined) return fail({ code: "NODE_NOT_FOUND", id });
  const updated = await board.post({
    mutation: { kind: "UPDATE_NODE", id, expectedVersion: node.version, props },
  });
  return updated.ok ? "ok" : fail(updated.error);
};

const linkReview = async (
  board: RemoteAgentConnection,
  n: number,
  id: string,
): Promise<Outcome> => {
  const edge = await board.post({
    mutation: {
      kind: "ADD_EDGE",
      id: `${REVIEWS_LABEL}:${id}`,
      label: REVIEWS_LABEL,
      from: id,
      to: prNodeId(n),
    },
  });
  return edge.ok || edge.error.code === "EDGE_EXISTS" ? "ok" : fail(edge.error);
};

const fail = (error: unknown): Outcome => {
  console.error(`whipple3 review: ${JSON.stringify(error)}`);
  return "error";
};

export const review = defineCommand({
  meta: {
    name: "review",
    description: "Record a verdict on a pull request as one reviewer identity.",
  },
  args: {
    ...prArgs,
    verdict: { type: "string", description: "approve | request_changes", required: true },
  },
  async run({ args }) {
    const n = parsePrNumber(args.number);
    const verdict = parseVerdict(args.verdict);
    if (n === null || verdict === null) {
      console.error(
        `whipple3 review: --number must be a positive integer and --verdict one of ${VERDICTS.join("|")}`,
      );
      process.exitCode = 1;
      return;
    }
    const board = await connectOrExit(args);
    if (board === null) return;
    const outcome = await upsertVerdict(board, n, args.agent, verdict);
    if (outcome === "ok") console.log(`review ${n}: ${verdict} by ${args.agent}`);
    board.close();
    process.exitCode = exitFor([outcome]);
  },
});
