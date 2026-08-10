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

/**
 * Role-declared slices (SPEC §4.7, ROADMAP Stage 2): a role's slice shape is pure DATA —
 * root label plus a tree of follow rules — never a function, never a query language.
 * F/T generics exist only so anchoring is checked at the call site; they erase to strings.
 */
export interface FollowRule<F extends string = string, T extends string = string> {
  readonly edge: string;
  readonly from: F;
  readonly to: T;
  /** Max consecutive hops along this one edge label (recursive edges want > 1). */
  readonly hops: number;
  /** Rules continuing from the nodes this rule reached. ("then" would make a thenable.) */
  readonly next: readonly FollowRule[];
}

export interface SliceDecl<R extends string = string> {
  readonly kind: "slice";
  readonly root: R;
  readonly follow: readonly FollowRule[];
}

/**
 * The slice-decl typo case: an edge that touches no label in A cannot attach there, at
 * compile time. Checked locally per call — anchoring is to the DECLARED endpoint labels,
 * so a rule anchored only to its parent's near side can be legal yet reach nothing.
 */
type Anchored<A extends string> = FollowRule<A, string> | FollowRule<string, A>;

/** NoInfer: labels are inferred from the node/edge types ONLY, never from the rules. */
export const follow = <E extends string, F extends string, T extends string>(
  via: EdgeType<E, F, T>,
  opts?: { readonly hops?: number; readonly next?: readonly NoInfer<Anchored<F | T>>[] },
): FollowRule<F, T> => ({
  edge: via.label,
  from: via.from,
  to: via.to,
  hops: opts?.hops ?? 1,
  next: opts?.next ?? [],
});

export const defineSlice = <R extends string>(
  root: { readonly kind: "node"; readonly label: R },
  rules: readonly NoInfer<Anchored<R>>[],
): SliceDecl<R> => ({ kind: "slice", root: root.label, follow: rules });
