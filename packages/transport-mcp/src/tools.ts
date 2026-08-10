import { z } from "zod";

/**
 * The six MCP tools of the blackboard (SPEC §6). Input schemas live here so the MCP
 * JSON Schemas are a projection of one source of truth (SPEC §9.3, DRY of knowledge).
 *
 * No tool accepts an agentId: identity is bound to the connection at `session.connect`,
 * never self-declared in a payload — otherwise the ACL is decorative. (SPEC §4.6)
 */
export const toolInputs = {
  blackboard_post: z.object({
    mutation: z.discriminatedUnion("kind", [
      z.object({
        kind: z.literal("ADD_NODE"),
        id: z.string().min(1),
        label: z.string().min(1),
        props: z.record(z.string(), z.unknown()),
      }),
      z.object({
        kind: z.literal("UPDATE_NODE"),
        id: z.string().min(1),
        expectedVersion: z.number().int().positive(),
        props: z.record(z.string(), z.unknown()),
      }),
      z.object({
        kind: z.literal("ADD_EDGE"),
        id: z.string().min(1),
        label: z.string().min(1),
        from: z.string().min(1),
        to: z.string().min(1),
      }),
    ]),
  }),
  // No depth parameter: scope belongs to the engine (role slice or server default),
  // never to the agent. (SPEC §4.7)
  blackboard_read: z.object({
    root: z.string().min(1),
  }),
  blackboard_claim: z.object({
    id: z.string().min(1),
    ttlMs: z.number().int().positive().default(120_000),
  }),
  blackboard_release: z.object({
    id: z.string().min(1),
  }),
  blackboard_next: z.object({
    label: z.string().min(1),
    match: z.record(z.string(), z.unknown()).default({}),
  }),
  blackboard_status: z.object({}),
} as const;

export type ToolName = keyof typeof toolInputs;
