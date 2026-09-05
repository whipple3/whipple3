import { z } from "zod";

/**
 * The primary target of a tool call — the thing the call was aimed at. Two calls count as
 * the same work only when tool AND target match.
 *
 * Tools with no comparable primary argument (MCP tools, Task, anything unrecognised) return
 * null and are EXCLUDED rather than guessed at. Guessing here would quietly inflate or
 * deflate every number downstream.
 *
 * This lives in the transcript package, not in the measuring tool, because the projection
 * and the measurement must agree about what "the same target" means. Two definitions would
 * eventually disagree about the same session, and the picture and the number would drift
 * apart without either being obviously wrong.
 */
const pathSchema = z.looseObject({ file_path: z.string() });
const commandSchema = z.looseObject({ command: z.string() });
const patternSchema = z.looseObject({ pattern: z.string(), path: z.string().optional() });
const urlSchema = z.looseObject({ url: z.string() });

export const primaryTarget = (tool: string, input: unknown): string | null => {
  const name = tool.toLowerCase();
  if (["read", "edit", "write", "notebookedit"].includes(name))
    return pathSchema.safeParse(input).data?.file_path ?? null;
  if (name === "bash") return commandSchema.safeParse(input).data?.command ?? null;
  if (name === "grep" || name === "glob") {
    const parsed = patternSchema.safeParse(input).data;
    return parsed === undefined ? null : `${parsed.pattern} @ ${parsed.path ?? "."}`;
  }
  if (name === "webfetch") return urlSchema.safeParse(input).data?.url ?? null;
  return null;
};

/** The three denominators reported side by side; narrowing one silently is the failure mode. */
export const LENSES = {
  all: () => true,
  lookups: (tool: string) => ["read", "grep", "glob", "webfetch"].includes(tool.toLowerCase()),
  reads: (tool: string) => tool.toLowerCase() === "read",
} as const;

export type Lens = keyof typeof LENSES;
