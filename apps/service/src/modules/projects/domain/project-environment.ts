/** A variable the Project's commands run with. */
export interface ProjectVariable {
  readonly name: string;
  readonly value: string;
  /**
   * A Secret variable: its value is never shown again once saved, and is hidden wherever it would
   * appear in output (spec §6).
   */
  readonly secret: boolean;
}

/**
 * How the Project's commands and Agents change the variables they inherit (spec §5.5): kept with
 * the Project, outside its checkout, and saved by the user's Save.
 */
export interface ProjectEnvironment {
  /** Variables set, in this order, over any inherited one of the same name. */
  readonly set: readonly ProjectVariable[];
  /** Inherited variables removed. */
  readonly unset: readonly string[];
  /** Folders put in front of PATH, in this order. */
  readonly prependPath: readonly string[];
}

/** A variable as the Project page saves it: a Secret variable without a value keeps its own. */
export type VariableEdit =
  | { readonly name: string; readonly secret: false; readonly value: string }
  | { readonly name: string; readonly secret: true; readonly value?: string };

/** The environment as the Project page saves it, its Secret variables' values left out to keep. */
export interface ProjectEnvironmentEdit {
  readonly set: readonly VariableEdit[];
  readonly unset: readonly string[];
  readonly prependPath: readonly string[];
}

/** A variable as it is shown: a Secret variable by its name alone. */
export type ShownVariable =
  | { readonly name: string; readonly secret: false; readonly value: string }
  | { readonly name: string; readonly secret: true; readonly valueSet: boolean };

/** The environment as the page, the API and events see it: no Secret variable's value. */
export interface ShownEnvironment {
  readonly set: readonly ShownVariable[];
  readonly unset: readonly string[];
  readonly prependPath: readonly string[];
}

/** A Project's environment until its first save: the inherited one, unchanged. */
export const UNCHANGED_ENVIRONMENT: ProjectEnvironment = { set: [], unset: [], prependPath: [] };

/** The shortest value a Secret variable takes, so hiding it in output never hides ordinary text. */
export const SECRET_VALUE_MIN_LENGTH = 6;

/**
 * The environment an edit describes, each Secret variable left without a value taking the one
 * `kept` (the Project's own) has under its name. One with no value there stays empty, for
 * environmentProblems to refuse.
 */
export function editedEnvironment(
  edit: ProjectEnvironmentEdit,
  kept: ProjectEnvironment,
): ProjectEnvironment {
  const keptValueOf = (name: string): string =>
    kept.set.find((variable) => variable.secret && variable.name === name)?.value ?? "";
  return {
    set: edit.set.map((variable): ProjectVariable => {
      const name = variable.name.trim();
      if (!variable.secret) return { name, value: variable.value, secret: false };
      const value =
        variable.value === undefined || variable.value === "" ? keptValueOf(name) : variable.value;
      return { name, value, secret: true };
    }),
    unset: edit.unset,
    prependPath: edit.prependPath,
  };
}

/** The environment without its Secret variables' values. */
export function shownEnvironment(environment: ProjectEnvironment): ShownEnvironment {
  return {
    set: environment.set.map(({ name, value, secret }): ShownVariable =>
      secret ? { name, secret, valueSet: value !== "" } : { name, secret, value },
    ),
    unset: [...environment.unset],
    prependPath: [...environment.prependPath],
  };
}

/**
 * The environment as it is kept: names and folders without the spaces around them, and without
 * rows left blank. Values stay as given, since a space in one may matter.
 */
export function trimmedEnvironment(environment: ProjectEnvironment): ProjectEnvironment {
  return {
    set: environment.set
      .map((variable) => ({ ...variable, name: variable.name.trim() }))
      .filter(({ name, value }) => name !== "" || value !== ""),
    unset: environment.unset.map((name) => name.trim()).filter((name) => name !== ""),
    prependPath: environment.prependPath
      .map((folder) => folder.trim())
      .filter((folder) => folder !== ""),
  };
}

/**
 * Why the environment's own fields, as trimmedEnvironment keeps them, can't be used; whether its
 * folders are absolute depends on the system, and is checked apart.
 */
export function environmentProblems(environment: ProjectEnvironment): string[] {
  const problems: string[] = [];
  for (const variable of environment.set) {
    const problem = variableNameProblem(variable.name);
    if (problem) problems.push(problem);
    problems.push(...variableValueProblems(variable));
  }
  problems.push(...repeatedNameProblems(environment.set));
  for (const name of environment.unset) {
    const problem = variableNameProblem(name);
    if (problem) problems.push(problem);
  }
  return problems;
}

/** Why a variable's value can't be saved: a NUL anywhere, or a Secret variable's value not one line of 6 or more. */
export function variableValueProblems({ name, value, secret }: ProjectVariable): string[] {
  if (value.includes("\0")) return [`The value of ${name} has a NUL character.`];
  if (!secret) return [];
  if (value === "") return [`Give the Secret variable ${name} a value.`];
  if (/[\r\n]/.test(value)) {
    return [`The value of the Secret variable ${name} has a line break: it takes one line.`];
  }
  if (value.length < SECRET_VALUE_MIN_LENGTH) {
    return [
      `The value of the Secret variable ${name} is shorter than ${SECRET_VALUE_MIN_LENGTH} characters, so hiding it in output could hide ordinary text.`,
    ];
  }
  return [];
}

/** Each name set more than once, or both plain and secret. */
export function repeatedNameProblems(variables: readonly ProjectVariable[]): string[] {
  const names = variables.map((variable) => variable.name);
  const repeated = new Set(names.filter((each, index) => names.indexOf(each) !== index));
  return [...repeated].map((name) => {
    const kinds = new Set(
      variables.filter((each) => each.name === name).map((each) => each.secret),
    );
    return kinds.size > 1
      ? `${name} is both a plain and a Secret variable: make it one or the other.`
      : `${name} is set more than once.`;
  });
}

export function variableNameProblem(name: string): string | undefined {
  if (name === "") return "Give each variable a name.";
  if (/[=\0]/.test(name)) return `A variable's name can't have "=" in it: ${name}.`;
  return undefined;
}

export function sameEnvironment(one: ProjectEnvironment, other: ProjectEnvironment): boolean {
  return (
    sameList(
      one.set,
      other.set,
      (a, b) => a.name === b.name && a.value === b.value && a.secret === b.secret,
    ) &&
    sameList(one.unset, other.unset, (a, b) => a === b) &&
    sameList(one.prependPath, other.prependPath, (a, b) => a === b)
  );
}

function sameList<Item>(
  ones: readonly Item[],
  others: readonly Item[],
  same: (one: Item, other: Item) => boolean,
): boolean {
  return (
    ones.length === others.length &&
    ones.every((item, index) => {
      const otherItem = others[index];
      return otherItem !== undefined && same(item, otherItem);
    })
  );
}
