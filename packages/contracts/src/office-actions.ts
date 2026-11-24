import type { z } from "zod";
import type { DutyKey } from "./people.js";

/** The records an Office action acts on, as the user sees them. */
export type OfficeActionRecord = "task" | "initiative" | "idea" | "project" | "role" | "skill";

/** The HTTP methods an Office action's route takes: each changes something. */
export type OfficeActionMethod = "POST" | "PUT" | "DELETE";

/**
 * The records a person creates in a Thread with an Office tool: create_task, capture_idea and
 * create_initiative.
 */
export type CreatedRecord = "task" | "idea" | "initiative";

/**
 * Who gets an Office action's tool, exactly one kind of cover (spec 5.4.1, "Office actions"):
 * - `duties`: a person holding one of them, in every Thread the user talks to them in;
 * - `creators`: whoever can create the record in the Thread, wherever its create tool is offered,
 *   so a person can fix what they made. Never in an Agent Stage.
 */
export type OfficeActionCover =
  | { readonly kind: "duties"; readonly duties: readonly [DutyKey, ...DutyKey[]] }
  | { readonly kind: "creators"; readonly record: CreatedRecord };

/**
 * One thing the user can do on a record, declared once (the Office action convention, spec 5.4):
 * the route the web calls and the Office tool Agents call both come from it, and both call the
 * one handler of the module that owns the record.
 */
export interface OfficeAction<
  Input extends z.ZodObject = z.ZodObject,
  Answer extends z.ZodType = z.ZodType,
> {
  /** The Office tool's name, in snake_case, unique among Office tools. */
  readonly name: string;
  readonly record: OfficeActionRecord;
  /** What the Agent reads to decide when to call it, in the UI's own words. */
  readonly description: string;
  /**
   * The route's path parameters and body together, and the tool's input: every `:name` of the
   * path is one of its keys.
   */
  readonly input: Input;
  /** What the route answers the web; the tool answers the Agent in words instead. */
  readonly answer: Answer;
  /** Under `/api`, its path parameters written `:name`. */
  readonly route: { readonly method: OfficeActionMethod; readonly path: string };
  /**
   * Who gets its tool (`OfficeActionCover`). Whether a call is allowed is the handler's domain
   * rules, the same for the user and Agents.
   */
  readonly coveredBy: OfficeActionCover;
}

/** Declares an Office action, refusing one whose path names a parameter its input doesn't have. */
export function officeAction<Input extends z.ZodObject, Answer extends z.ZodType>(
  action: OfficeAction<Input, Answer>,
): OfficeAction<Input, Answer> {
  const parameters = pathParametersOf(action.route.path);
  const missing = parameters.filter((parameter) => !(parameter in action.input.shape));
  if (missing.length > 0) {
    throw new Error(`The Office action ${action.name}'s input lacks ${missing.join(", ")}.`);
  }
  const inBody = Object.keys(action.input.shape).filter((key) => !parameters.includes(key));
  if (action.route.method === "DELETE" && inBody.length > 0) {
    throw new Error(
      `The Office action ${action.name} is a DELETE, so its path names all its input.`,
    );
  }
  // The tuple type keeps duties non-empty for typed callers; this refuses an empty one cast past it.
  if (action.coveredBy.kind === "duties" && action.coveredBy.duties.length === 0) {
    throw new Error(`The Office action ${action.name} names no duty that covers it.`);
  }
  return action;
}

/** The names of a route path's parameters, in order: `/tasks/:taskId` has `taskId`. */
export function pathParametersOf(path: string): string[] {
  return [...path.matchAll(/:([A-Za-z]\w*)/g)].map(([, name]) => name as string);
}

/** The action's path with its parameters filled in from `input`, under `/api`'s root. */
export function officeActionPath<Input extends z.ZodObject>(
  action: OfficeAction<Input>,
  input: z.input<Input>,
): string {
  const values = input as Record<string, unknown>;
  return action.route.path.replaceAll(/:([A-Za-z]\w*)/g, (_, name: string) =>
    encodeURIComponent(String(values[name])),
  );
}

/** What of `input` goes in the request's body: all but the path's parameters; none for DELETE. */
export function officeActionBody<Input extends z.ZodObject>(
  action: OfficeAction<Input>,
  input: z.input<Input>,
): Record<string, unknown> | undefined {
  if (action.route.method === "DELETE") return undefined;
  const parameters = new Set(pathParametersOf(action.route.path));
  return Object.fromEntries(
    Object.entries(input as Record<string, unknown>).filter(([key]) => !parameters.has(key)),
  );
}
