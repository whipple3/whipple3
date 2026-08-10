import { type AclPolicy, type FollowRule, ok, type Result, type SliceDecl } from "@whipple3/core";
import { z } from "zod";
import { type ParseError, parseWith } from "./parse.js";

/**
 * The policy file: how ACL + role slices enter a session from the outside (serve --policy).
 * This is the exact seam central policy distribution would use — one file locally today,
 * one endpoint org-wide later. (SPEC §4.6, ROADMAP Stage 9)
 */
const agentAclSchema = z.object({
  write: z.array(z.string()),
  read: z.array(z.string()),
});

const followRuleSchema: z.ZodType<FollowRule> = z.lazy(() =>
  z.object({
    edge: z.string().min(1),
    from: z.string().min(1),
    to: z.string().min(1),
    hops: z.number().int().positive(),
    next: z.array(followRuleSchema),
  }),
);

const sliceDeclSchema: z.ZodType<SliceDecl> = z.object({
  kind: z.literal("slice"),
  root: z.string().min(1),
  follow: z.array(followRuleSchema),
});

const policyFileSchema = z.object({
  acl: z.record(z.string(), agentAclSchema).optional(),
  slices: z.record(z.string(), sliceDeclSchema).optional(),
});

export interface PolicyConfig {
  readonly acl: AclPolicy | null;
  readonly slices?: Readonly<Record<string, SliceDecl>> | undefined;
}

export const parsePolicy = (input: unknown): Result<PolicyConfig, ParseError> => {
  const parsed = parseWith(policyFileSchema, input);
  if (!parsed.ok) return parsed;
  return ok({ acl: parsed.value.acl ?? null, slices: parsed.value.slices });
};
