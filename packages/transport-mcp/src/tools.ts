import { z } from "zod";

/**
 * The six MCP tools of the blackboard (SPEC §6). Input schemas live here so the MCP
 * JSON Schemas are a projection of one source of truth (SPEC §9.3, DRY of knowledge).
 *
 * No tool accepts an agentId: identity is bound to the connection at `session.connect`,
 * never self-declared in a payload — otherwise the ACL is decorative. (SPEC §4.6)
 */

/** A lease is a work grant, not ownership: an unbounded ttl would lock a node forever. */
export const CLAIM_TTL_MAX_MS = 3_600_000;
/** The graph is the control plane — paths/hashes/status, never contents. (SPEC §4.7) */
export const PROPS_MAX_BYTES = 16_384;
const NAME_MAX = 256;

/**
 * ids and labels cross trust boundaries verbatim — report markdown (`### ${label}`,
 * `` `${id}` `` in distill) and Studio labels — so their alphabet is closed: no
 * whitespace, newlines or backticks. Covers the demo conventions
 * (`file:src/auth.ts`, `issue:src/x.ts#slug`, `HAS_ISSUE`).
 */
const boardName = z
  .string()
  .min(1)
  .max(NAME_MAX)
  .regex(/^[\w:./#-]+$/, "letters, digits and _ : . / # - only");

/** Budget in UTF-8 BYTES, not code units — the log and the context window pay in bytes. */
const boundedProps = z
  .record(z.string(), z.unknown())
  .refine((p) => new TextEncoder().encode(JSON.stringify(p)).length <= PROPS_MAX_BYTES, {
    message: `props exceed ${PROPS_MAX_BYTES} bytes — store paths and hashes, never contents (SPEC §4.7)`,
  });

export const toolInputs = {
  blackboard_post: z.object({
    mutation: z.discriminatedUnion("kind", [
      z.object({
        kind: z.literal("ADD_NODE"),
        id: boardName,
        label: boardName,
        props: boundedProps,
      }),
      z.object({
        kind: z.literal("UPDATE_NODE"),
        id: boardName,
        expectedVersion: z.number().int().positive(),
        props: boundedProps,
      }),
      z.object({
        kind: z.literal("ADD_EDGE"),
        id: boardName,
        label: boardName,
        from: boardName,
        to: boardName,
      }),
    ]),
  }),
  // No depth parameter: scope belongs to the engine (role slice or server default),
  // never to the agent. (SPEC §4.7)
  blackboard_read: z.object({
    root: boardName,
  }),
  blackboard_claim: z.object({
    id: boardName,
    ttlMs: z.number().int().positive().max(CLAIM_TTL_MAX_MS).default(120_000),
  }),
  blackboard_release: z.object({
    id: boardName,
  }),
  blackboard_next: z.object({
    label: boardName,
    match: z.record(z.string(), z.unknown()).default({}),
  }),
  blackboard_status: z.object({}),
} as const;

export type ToolName = keyof typeof toolInputs;
