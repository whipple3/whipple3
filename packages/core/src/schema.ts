import { z } from "zod";

/**
 * The typed DSL. The type-gymnastics budget (SPEC §9.3) is spent here and only here:
 * schema authors write plain object literals — no manual generics — and get full literal
 * inference back, so a typo'd prop VALUE or prop NAME in `when()` is a compile error.
 * Runtime stays boring; every type below erases to the same objects as before.
 */

/** The prop types a node schema declares — types flow inward from the Zod shape. */
type Props<S extends z.ZodRawShape> = z.infer<z.ZodObject<S>>;

/**
 * Excess-property checking only fires on inline literals; a match object built elsewhere
 * could smuggle a typo'd key past `Partial`. Mapping every key not in P to `never` makes
 * that a compile error on every entry path. Trade-off: inline name typos now report
 * "not assignable to never" on the offending key instead of TS2561's "did you mean".
 */
type ExactKeys<M, P> = { readonly [K in Exclude<keyof M, keyof P>]: never };

export interface NodeType<L extends string, S extends z.ZodRawShape> {
  readonly kind: "node";
  readonly label: L;
  readonly props: z.ZodObject<S>;
  when<M extends Partial<Props<S>>>(match: M & ExactKeys<M, Props<S>>): Trigger<L, M>;
}

/** F/T default to string so pre-inference references (`EdgeType<L>`) stay valid. */
export interface EdgeType<L extends string, F extends string = string, T extends string = string> {
  readonly kind: "edge";
  readonly label: L;
  readonly from: F;
  readonly to: T;
}

/**
 * Pull-mode trigger descriptor: compiled to a work-queue query, not a push subscription.
 * (ADR-002) M carries `when()`'s inferred match; it defaults so bare `Trigger` (slice.ts,
 * index.ts) keeps its exact pre-inference shape — the frozen contract is untouched.
 */
export interface Trigger<L extends string = string, M = Record<string, unknown>> {
  readonly label: L;
  readonly match: Readonly<M>;
}

export const defineNode = <L extends string, S extends z.ZodRawShape>(
  label: L,
  shape: S,
): NodeType<L, S> => {
  const props = z.object(shape);
  return {
    kind: "node",
    label,
    props,
    when(match) {
      return { label, match };
    },
  };
};

export const defineEdge = <L extends string, F extends string, T extends string>(
  label: L,
  ends: { readonly from: { readonly label: F }; readonly to: { readonly label: T } },
): EdgeType<L, F, T> => ({ kind: "edge", label, from: ends.from.label, to: ends.to.label });
