import { keyShapeProblem } from "./project.js";
import type { ProjectVariable } from "./project-environment.js";

/**
 * A Project's Action (spec §2.15): a named entry in its settings the user runs on demand, outside
 * the Task queue. Kept in the database only; running one is the Actions module's.
 */

/** The kinds an Action may be (spec §2.15, "Kinds"), mirrored by contracts' `ACTION_KINDS`. */
export const ACTION_KINDS = ["project-command", "test-target", "workflow"] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];

export const ACTION_KIND_NAMES: Readonly<Record<ActionKind, string>> = {
  "project-command": "Project command",
  "test-target": "Test target",
  workflow: "Workflow",
};

/** How long an Action's name may be. */
export const ACTION_NAME_MAX_LENGTH = 60;

/** The bounds of an Action's own time limit, in minutes (spec §2.15, "An Action's time limit"). */
export const ACTION_TIME_LIMIT_MINUTES = { min: 1, max: 240, default: 60 } as const;

/**
 * The variables The Office sets in a Project command run (spec §2.15, "What The Office sets"): no
 * Project variable may take one of these names while the Project has a Project command Action.
 */
export const ACTION_RESERVED_VARIABLES: readonly string[] = [
  "OFFICE_ACTION",
  "OFFICE_ACTION_BRANCH",
  "OFFICE_ACTION_COMMIT",
];

/** The values of an Action that each record who set them last. */
export const ACTION_FIELDS = ["name", "kind", "settings", "leavesTheWorkstation"] as const;
export type ActionField = (typeof ACTION_FIELDS)[number];

export interface ProjectCommandActionSettings {
  readonly commandKey: string;
  /** The Project's commands run before it, `install` among them, in order, by their keys. */
  readonly commandsBefore: readonly string[];
  /** Its own time limit in minutes; null when the default applies. */
  readonly timeLimitMinutes: number | null;
}

export interface TestTargetActionSettings {
  readonly targetKey: string;
}

export interface WorkflowActionSettings {
  /** The Workflow's file name, such as release.yml. */
  readonly file: string;
  /** Its inputs by name, each as text, fixed with the Action. */
  readonly inputs: Readonly<Record<string, string>>;
}

/** An Action's values, without who set them. */
export type ActionFields = {
  readonly key: string;
  readonly name: string;
  readonly leavesTheWorkstation: boolean;
} & (
  | { readonly kind: "project-command"; readonly settings: ProjectCommandActionSettings }
  | { readonly kind: "test-target"; readonly settings: TestTargetActionSettings }
  | { readonly kind: "workflow"; readonly settings: WorkflowActionSettings }
);

/** Who set a value last: a user on the Project page, or a Proposal an Agent drafted. */
export type ActionSetter =
  | { readonly by: "user"; readonly user: { readonly userId: string; readonly name: string } }
  | {
      readonly by: "proposal";
      readonly proposalId: string;
      readonly agent: { readonly roleKey: string; readonly name: string };
    };

export type ActionSetBy = Readonly<Partial<Record<ActionField, ActionSetter>>>;

/** An Action as kept. */
export type Action = ActionFields & { readonly setBy: ActionSetBy };

/** What an Action's values are checked against: the Project as it is now. */
export interface ActionContext {
  readonly projectName: string;
  /** The Project's own commands' keys, which a Project command Action runs. */
  readonly commandKeys: readonly string[];
  /** The keys a command before it may name: the Project's commands, and `install` when it has one. */
  readonly commandBeforeKeys: readonly string[];
  /** The Project's test targets' keys. */
  readonly targetKeys: readonly string[];
  /** The Project's environment and Secret variables. */
  readonly variables: readonly Pick<ProjectVariable, "name">[];
}

export function actionLabel(key: string): string {
  return `Action "${key}"`;
}

/** The Workflow's file name, a path given or not: `.github/workflows/release.yml` is release.yml. */
export function workflowFileName(file: string): string {
  const parts = file.replaceAll("\\", "/").split("/");
  return parts[parts.length - 1] ?? file;
}

/**
 * The Action as it is kept: without the spaces around what was typed, and a Workflow's file by its
 * name, as Work › CI lists it.
 */
export function trimmedAction(action: ActionFields): ActionFields {
  const head = {
    key: action.key.trim(),
    name: action.name.trim(),
    leavesTheWorkstation: action.leavesTheWorkstation,
  };
  switch (action.kind) {
    case "project-command":
      return {
        ...head,
        kind: action.kind,
        settings: {
          commandKey: action.settings.commandKey.trim(),
          commandsBefore: action.settings.commandsBefore.map((key) => key.trim()),
          timeLimitMinutes: action.settings.timeLimitMinutes,
        },
      };
    case "test-target":
      return {
        ...head,
        kind: action.kind,
        settings: { targetKey: action.settings.targetKey.trim() },
      };
    case "workflow":
      return {
        ...head,
        kind: action.kind,
        settings: {
          file: workflowFileName(action.settings.file.trim()),
          inputs: Object.fromEntries(
            Object.entries(action.settings.inputs).map(([name, value]) => [name.trim(), value]),
          ),
        },
      };
  }
}

/**
 * The Action a Proposal gives, marked as the rules mark it (spec §2.15, "Leaves the workstation"):
 * one added as a Workflow, or changed to one from another kind, leaves the workstation whatever
 * was given; any other keeps the value given. The Project page's editor ticks the mark itself, and
 * the user may clear it before saving, so their Save keeps what they sent.
 */
export function markedAction<Fields extends ActionFields>(
  before: Pick<ActionFields, "kind"> | undefined,
  after: Fields,
): Fields {
  const becomesWorkflow = after.kind === "workflow" && before?.kind !== "workflow";
  return becomesWorkflow ? { ...after, leavesTheWorkstation: true } : after;
}

/**
 * The page's whole list as it would be kept: trimmed, with who set each value as stored until
 * `setByAfter` stamps the changes.
 */
export function editedActions(stored: readonly Action[], edit: readonly ActionFields[]): Action[] {
  return edit.map((given) => {
    const trimmed = trimmedAction(given);
    const before = stored.find(({ key }) => key === trimmed.key);
    return { ...trimmed, setBy: before?.setBy ?? {} };
  });
}

/** Whether two of an Action's settings are the same, inputs in any order. */
export function sameSettings(one: ActionFields, other: ActionFields): boolean {
  if (one.kind === "project-command" && other.kind === "project-command") {
    return (
      one.settings.commandKey === other.settings.commandKey &&
      sameList(one.settings.commandsBefore, other.settings.commandsBefore) &&
      one.settings.timeLimitMinutes === other.settings.timeLimitMinutes
    );
  }
  if (one.kind === "test-target" && other.kind === "test-target") {
    return one.settings.targetKey === other.settings.targetKey;
  }
  if (one.kind === "workflow" && other.kind === "workflow") {
    const oneInputs = Object.entries(one.settings.inputs);
    return (
      one.settings.file === other.settings.file &&
      oneInputs.length === Object.keys(other.settings.inputs).length &&
      oneInputs.every(
        ([name, value]) =>
          Object.hasOwn(other.settings.inputs, name) && other.settings.inputs[name] === value,
      )
    );
  }
  return false;
}

export function sameField(field: ActionField, one: ActionFields, other: ActionFields): boolean {
  switch (field) {
    case "name":
      return one.name === other.name;
    case "kind":
      return one.kind === other.kind;
    case "settings":
      return sameSettings(one, other);
    case "leavesTheWorkstation":
      return one.leavesTheWorkstation === other.leavesTheWorkstation;
  }
}

/** The values of `after` that differ from `before`'s, every one for an Action added. */
export function changedFields(
  before: ActionFields | undefined,
  after: ActionFields,
): ActionField[] {
  return ACTION_FIELDS.filter((field) => before === undefined || !sameField(field, before, after));
}

/**
 * Who set each of `after`'s values: `setter` for each that changed from `before`, else as kept.
 * With no `setter`, as for a person's change on a Task, a value that changed has no known setter.
 */
export function setByAfter(
  before: Action | undefined,
  after: ActionFields,
  setter: ActionSetter | undefined,
): ActionSetBy {
  const changed = changedFields(before, after);
  const setBy: Partial<Record<ActionField, ActionSetter>> = {};
  for (const field of ACTION_FIELDS) {
    const kept = before?.setBy[field];
    if (changed.includes(field)) {
      if (setter) setBy[field] = setter;
    } else if (kept) setBy[field] = kept;
  }
  return setBy;
}

function sameSetter(one: ActionSetter | undefined, other: ActionSetter | undefined): boolean {
  if (one === undefined || other === undefined) return one === other;
  if (one.by === "user") {
    return (
      other.by === "user" &&
      one.user.userId === other.user.userId &&
      one.user.name === other.user.name
    );
  }
  return (
    other.by === "proposal" &&
    one.proposalId === other.proposalId &&
    one.agent.roleKey === other.agent.roleKey &&
    one.agent.name === other.agent.name
  );
}

/** Whether the two lists hold the same Actions, in the same order, with the same values. */
export function sameActions(one: readonly Action[], other: readonly Action[]): boolean {
  return (
    one.length === other.length &&
    one.every((action, index) => {
      const each = other[index];
      return (
        each !== undefined &&
        action.key === each.key &&
        ACTION_FIELDS.every((field) => sameField(field, action, each)) &&
        ACTION_FIELDS.every((field) => sameSetter(action.setBy[field], each.setBy[field]))
      );
    })
  );
}

/** The keys of `before` that `after` no longer has. */
export function removedKeys(
  before: readonly Pick<ActionFields, "key">[],
  after: readonly Pick<ActionFields, "key">[],
): string[] {
  return before.map(({ key }) => key).filter((key) => !after.some((each) => each.key === key));
}

/**
 * Every reason the Project's Actions, whole, can't be saved, each naming its Action (spec §2.15;
 * the Project page's rules, which a Proposal's result is checked by too). A Workflow's file and
 * inputs are checked against the base branch apart, as that asks the code host.
 */
export function actionProblems(actions: readonly ActionFields[], context: ActionContext): string[] {
  const problems: string[] = [];
  const keys = actions.map(({ key }) => key);
  for (const key of new Set(keys.filter((each, index) => keys.indexOf(each) !== index))) {
    problems.push(`The key ${key} is taken by another Action.`);
  }
  for (const action of actions) {
    problems.push(
      ...oneActionProblems(action, context).map(
        (problem) => `${actionLabel(action.key)}: ${problem}`,
      ),
    );
  }
  return problems;
}

function oneActionProblems(action: ActionFields, context: ActionContext): string[] {
  const problems: string[] = [];
  const keyProblem = keyShapeProblem(action.key, "An Action's");
  if (keyProblem) problems.push(keyProblem);
  if (action.name === "") problems.push("Give it a name.");
  else if (action.name.length > ACTION_NAME_MAX_LENGTH) {
    problems.push(`Its name may be at most ${ACTION_NAME_MAX_LENGTH} characters.`);
  } else if (/[\r\n\0]/.test(action.name)) problems.push("Its name must be one line.");
  switch (action.kind) {
    case "project-command":
      problems.push(...projectCommandProblems(action.settings, context));
      break;
    case "test-target":
      if (!context.targetKeys.includes(action.settings.targetKey)) {
        problems.push(
          `${action.settings.targetKey || "(none)"} isn't one of «${context.projectName}»'s test targets.`,
        );
      }
      break;
    case "workflow":
      if (action.settings.file === "") {
        problems.push("Give the Workflow's file, such as release.yml.");
      }
      break;
  }
  return problems;
}

function projectCommandProblems(
  settings: ProjectCommandActionSettings,
  context: ActionContext,
): string[] {
  const problems: string[] = [];
  if (!context.commandKeys.includes(settings.commandKey)) {
    problems.push(
      `${settings.commandKey || "(none)"} isn't one of «${context.projectName}»'s commands.`,
    );
  }
  for (const key of new Set(settings.commandsBefore)) {
    if (!context.commandBeforeKeys.includes(key)) {
      problems.push(
        `${key}, among the commands before it, isn't one of «${context.projectName}»'s commands.`,
      );
    }
  }
  const limit = settings.timeLimitMinutes;
  const { min, max } = ACTION_TIME_LIMIT_MINUTES;
  if (limit !== null && (!Number.isInteger(limit) || limit < min || limit > max)) {
    problems.push(`Its time limit is a whole number of minutes from ${min} to ${max}.`);
  }
  problems.push(...reservedVariableProblems(context.variables));
  return problems;
}

/** A Project variable named as one The Office sets in a Project command run, each by name. */
export function reservedVariableProblems(
  variables: readonly Pick<ProjectVariable, "name">[],
): string[] {
  const names = new Set(variables.map(({ name }) => name));
  return ACTION_RESERVED_VARIABLES.filter((name) => names.has(name)).map(
    (name) =>
      `${name} is a variable The Office sets in an Action's run; rename the Project variable.`,
  );
}

/**
 * The reverse of `reservedVariableProblems`, for a save of the Project's environment: a variable
 * of a name The Office sets is refused while the Project has a Project command Action.
 */
export function reservedEnvironmentProblems(
  variables: readonly Pick<ProjectVariable, "name">[],
  actions: readonly ActionFields[],
): string[] {
  const commandAction = actions.find(({ kind }) => kind === "project-command");
  if (commandAction === undefined) return [];
  const names = new Set(variables.map(({ name }) => name));
  return ACTION_RESERVED_VARIABLES.filter((name) => names.has(name)).map(
    (name) =>
      `${name} is a variable The Office sets in an Action's run, such as ${commandAction.name}'s; give the Project variable another name.`,
  );
}

function sameList(one: readonly string[], other: readonly string[]): boolean {
  return one.length === other.length && one.every((each, index) => each === other[index]);
}
