import { z } from "zod";

/**
 * The UDS wire: NDJSON — one JSON frame per LF-terminated line. A connection speaks
 * exactly one hello (binding its agent identity, ADR-007), then req/res frames that
 * map 1:1 onto the AgentConnection surface. Results cross as-is; errors are always
 * structured values, never prose. (SPEC §4.6, §6)
 */
export const OPS = ["post", "claim", "release", "next", "read", "status"] as const;
export type Op = (typeof OPS)[number];

/** Bump v when a frame shape changes; the server rejects hellos it does not speak. */
export const PROTOCOL_VERSION = 1;

export const clientFrame = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("hello"),
    v: z.literal(PROTOCOL_VERSION),
    agentId: z.string().min(1),
  }),
  z.object({
    kind: z.literal("req"),
    id: z.number().int().nonnegative(),
    op: z.enum(OPS),
    /** Optional: status carries no input; the session re-parses whatever arrives. */
    input: z.unknown().optional(),
  }),
]);
export type ClientFrame = z.output<typeof clientFrame>;
export type ReqFrame = Extract<ClientFrame, { kind: "req" }>;

export const serverFrame = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ready") }),
  z.object({ kind: z.literal("res"), id: z.number().int().nonnegative(), result: z.unknown() }),
  z.object({
    kind: z.literal("err"),
    /** null when the failure cannot be correlated to a request (e.g. unparseable line). */
    id: z.number().int().nonnegative().nullable(),
    error: z.object({
      code: z.enum(["BAD_FRAME", "HELLO_REQUIRED", "INTERNAL"]),
      message: z.string().optional(),
    }),
  }),
]);
export type ServerFrame = z.output<typeof serverFrame>;

export const encodeFrame = (frame: ClientFrame | ServerFrame): string =>
  `${JSON.stringify(frame)}\n`;

/** Chunk → complete lines; the partial tail waits for its newline. Empty lines drop. */
export const createLineBuffer = (): ((chunk: string) => string[]) => {
  let tail = "";
  return (chunk) => {
    const pieces = (tail + chunk).split("\n");
    tail = pieces.pop() ?? "";
    return pieces.filter((line) => line !== "");
  };
};
