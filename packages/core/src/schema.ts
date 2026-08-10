import { z } from "zod";

/**
 * The typed DSL. This is where the type-gymnastics budget is spent (SPEC §9.3):
 * TODO(W1): full literal inference so `when({ status: "pendig" })` is a compile error.
 */
export interface NodeType<L extends string, S extends z.ZodRawShape> {
  readonly kind: "node";
  readonly label: L;
  readonly props: z.ZodObject<S>;
  when(match: Partial<z.infer<z.ZodObject<S>>>): Trigger<L>;
}

export interface EdgeType<L extends string> {
  readonly kind: "edge";
  readonly label: L;
  readonly from: string;
  readonly to: string;
}

/** Pull-mode trigger descriptor: compiled to a work-queue query, not a push subscription. (ADR-002) */
export interface Trigger<L extends string = string> {
  readonly label: L;
  readonly match: Readonly<Record<string, unknown>>;
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

export const defineEdge = <L extends string>(
  label: L,
  ends: { readonly from: { readonly label: string }; readonly to: { readonly label: string } },
): EdgeType<L> => ({ kind: "edge", label, from: ends.from.label, to: ends.to.label });
