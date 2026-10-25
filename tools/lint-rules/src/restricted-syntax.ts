import type { Rule } from "./imports.ts";

type Visitor = ReturnType<NonNullable<Rule["create"]>>;
type ReportedNode = Parameters<NonNullable<Visitor["Program"]>>[0];
type Listener = (node: ReportedNode) => void;

export interface RestrictedSyntax {
  /** An ESLint selector (esquery) naming the syntax to refuse. */
  readonly selector: string;
  readonly message: string;
}

/**
 * ESLint's `no-restricted-syntax` in its object form, which oxlint has no native rule for: refuses
 * every node a selector matches, with that selector's message.
 */
export const restrictedSyntax: Rule = {
  meta: {
    type: "suggestion",
    docs: { description: "Refuse the syntax the given selectors match." },
    schema: {
      type: "array",
      items: {
        type: "object",
        properties: { selector: { type: "string" }, message: { type: "string" } },
        required: ["selector", "message"],
        additionalProperties: false,
      },
    },
  },
  create: (context) => {
    const listeners: Record<string, Listener> = {};
    // The schema has checked their shape.
    const restrictions = context.options as unknown as readonly RestrictedSyntax[];
    for (const { selector, message } of restrictions) {
      const earlier = listeners[selector];
      listeners[selector] = (node) => {
        earlier?.(node);
        context.report({ node, message });
      };
    }
    return listeners;
  },
};
