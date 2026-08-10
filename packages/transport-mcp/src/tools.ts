import { z } from "zod";

/**
 * The five MCP tools of the blackboard (SPEC §6). Input schemas live here so the MCP
 * JSON Schemas are a projection of one source of truth (SPEC §9.3, DRY of knowledge).
 */
export const toolInputs = {
  blackboard_post: z.object({
    agentId: z.string().min(1),
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
  blackboard_read: z.object({
    agentId: z.string().min(1),
    root: z.string().min(1),
    depth: z.number().int().min(0).max(5).default(2),
  }),
  blackboard_claim: z.object({
    agentId: z.string().min(1),
    id: z.string().min(1),
    ttlMs: z.number().int().positive().default(120_000),
  }),
  blackboard_next: z.object({
    agentId: z.string().min(1),
    label: z.string().min(1),
    match: z.record(z.string(), z.unknown()).default({}),
  }),
  blackboard_status: z.object({}),
} as const;

export type ToolName = keyof typeof toolInputs;
