import type { NodeRecord, Slice } from "@whipple3/core";

export const REVIEW_LABEL = "Review";
export const COMMENT_LABEL = "ReviewComment";

const onPr = (slice: Slice, label: string, n: number): readonly NodeRecord[] =>
  slice.nodes.filter((x) => x.label === label && x.props.pr === n);

const changesRequested = (slice: Slice, n: number): readonly string[] =>
  onPr(slice, REVIEW_LABEL, n)
    .filter((r) => r.props.verdict === "request_changes")
    .map((r) => `changes requested by ${String(r.props.reviewer)}`);

const openBlocking = (slice: Slice, n: number): readonly string[] =>
  onPr(slice, COMMENT_LABEL, n)
    .filter((c) => c.props.severity === "blocking" && c.props.status === "open")
    .map((c) => `blocking: ${c.id} ${String(c.props.path)}`);

/**
 * The review half of the merge gate, pure over the slice `pr check` already reads. No
 * review is not a refusal — the forge's own protection still covers the human side.
 */
export const reviewGate = (slice: Slice, n: number): readonly string[] => [
  ...changesRequested(slice, n),
  ...openBlocking(slice, n),
];
