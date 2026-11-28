import type { Rule } from "./imports.ts";

type Visitor = ReturnType<NonNullable<Rule["create"]>>;
type UnaryExpression = Parameters<NonNullable<Visitor["UnaryExpression"]>>[0];
type Expression = UnaryExpression["argument"];

const MESSAGE =
  "A voided call ends in .catch(...): a promise left running with nobody catching its rejection ends the service. Await it, end it in .catch(...), or drop the void when it returns no promise.";

/**
 * Refuses `void call()` unless the call is `.catch(...)` or `.then(onFulfilled, onRejected)`: a
 * fire-and-forget promise whose rejection nobody handles is an unhandled rejection, which ends the
 * service. Syntax only, as oxlint has no type information: a voided call that returns no promise
 * drops its `void` instead. `void name` and `void object.property` stay allowed, as they mark a
 * value read on purpose.
 */
export const caughtVoidedCalls: Rule = {
  meta: {
    type: "problem",
    docs: { description: "End a fire-and-forget promise in .catch(...)." },
  },
  create: (context) => ({
    UnaryExpression: (node) => {
      if (node.operator !== "void") return;
      const call = calledIn(node.argument);
      if (call && !handlesRejection(call)) context.report({ node, message: MESSAGE });
    },
  }),
};

type Call = Extract<Expression, { type: "CallExpression" }>;

/** The call an expression makes, through an optional chain, or undefined when it makes none. */
function calledIn(expression: Expression): Call | undefined {
  if (expression.type === "ChainExpression") {
    return expression.expression.type === "CallExpression" ? expression.expression : undefined;
  }
  return expression.type === "CallExpression" ? expression : undefined;
}

/** `.catch(handler)` or `.then(onFulfilled, onRejected)`. */
function handlesRejection(call: Call): boolean {
  const callee = call.callee;
  if (callee.type !== "MemberExpression" || callee.computed) return false;
  if (callee.property.type !== "Identifier") return false;
  const method = callee.property.name;
  return (
    (method === "catch" && call.arguments.length >= 1) ||
    (method === "then" && call.arguments.length >= 2)
  );
}
