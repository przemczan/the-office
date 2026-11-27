import type { z } from "zod";
import {
  authorityAreaKeySchema,
  authorityGroupSchema,
  isGroupOfArea,
  type AuthorityAreaKey,
  type AuthorityGroup,
  type AuthorityValue,
} from "./authority.js";

/** What an Office action changes, as the user sees it: every subject a user changes. */
export type OfficeActionSubjectKind =
  | "task"
  | "initiative"
  | "idea"
  | "project"
  | "role"
  | "skill"
  | "mcp-server"
  | "pipeline"
  | "stage-template"
  | "office-setting"
  | "test-instance"
  | "saved-view"
  | "stage-run";

/** The one subject a call of an Office action changes, by its kind and its id. */
export interface OfficeActionSubject {
  readonly kind: OfficeActionSubjectKind;
  readonly id: string;
}

/** The HTTP methods an Office action's route takes: each changes something. */
export type OfficeActionMethod = "POST" | "PUT" | "DELETE";

/**
 * One thing the user can do, declared once (the Office action convention, spec 5.4): the route the
 * web calls and the Office tool Agents call both come from it, and both call the one handler of
 * the module that owns the subject.
 */
export interface OfficeAction<
  Input extends z.ZodObject = z.ZodObject,
  Answer extends z.ZodType = z.ZodType,
> {
  /** The Office tool's name, in snake_case, unique among Office tools. */
  readonly name: string;
  /** What a Proposal or an approval card calls the action, as the user reads it: "Start a Task". */
  readonly title: string;
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
  /** The status its route answers with when it succeeds; 200 when left out. */
  readonly status?: 200 | 201;
  /** The tool area it belongs to (spec 6 › Tool areas). */
  readonly area: AuthorityAreaKey;
  /**
   * The group or single tool of that area whose Authority setting rules it. Whether a call is
   * allowed beyond that is the handler's domain rules, the same for the user and Agents.
   */
  readonly group: AuthorityGroup;
  /**
   * The single tool whose Authority setting rules a call on the person's own work instead of
   * `group` (spec 6 › Authority), such as Continue at a Gate on own work; left out, `group` rules
   * every call.
   */
  readonly onOwnWork?: AuthorityGroup;
  /**
   * What the action starts at on a card with no setting for its group, when that differs from the
   * group's own default; left out, the group's default rules.
   */
  readonly defaultAuthority?: AuthorityValue;
  /** The subject a call with this input changes, so the ruling tells own work from others'. */
  subject(input: z.output<Input>): OfficeActionSubject;
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
  if (!authorityAreaKeySchema.safeParse(action.area).success) {
    throw new Error(`The Office action ${action.name}'s area ${action.area} isn't in the catalog.`);
  }
  if (!authorityGroupSchema.safeParse(action.group).success) {
    throw new Error(
      `The Office action ${action.name}'s group ${action.group} isn't in the catalog.`,
    );
  }
  if (!isGroupOfArea(action.area, action.group)) {
    throw new Error(
      `The Office action ${action.name}'s group ${action.group} isn't in the area ${action.area}.`,
    );
  }
  if (action.onOwnWork !== undefined) {
    if (!authorityGroupSchema.safeParse(action.onOwnWork).success) {
      throw new Error(
        `The Office action ${action.name}'s own-work row ${action.onOwnWork} isn't in the catalog.`,
      );
    }
    if (!isGroupOfArea(action.area, action.onOwnWork)) {
      throw new Error(
        `The Office action ${action.name}'s own-work row ${action.onOwnWork} isn't in the area ${action.area}.`,
      );
    }
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
