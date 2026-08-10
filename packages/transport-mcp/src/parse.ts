import { err, ok, type Result } from "@whipple3/core";
import type { z } from "zod";

export interface ParseError {
  readonly code: "PARSE_ERROR";
  readonly issues: readonly { readonly path: string; readonly message: string }[];
}

/** One boundary parser for every unknown that enters the shell. ("parse, don't validate") */
export const parseWith = <T>(schema: z.ZodType<T>, input: unknown): Result<T, ParseError> => {
  const r = schema.safeParse(input);
  if (r.success) return ok(r.data);
  return err({
    code: "PARSE_ERROR",
    issues: r.error.issues.map((i) => ({ path: i.path.map(String).join("."), message: i.message })),
  });
};
