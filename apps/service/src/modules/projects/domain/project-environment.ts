/** A variable the Project's commands run with. */
export interface ProjectVariable {
  readonly name: string;
  readonly value: string;
}

/**
 * How the Project's commands and Agents change the variables they inherit (spec §5.5): kept with
 * the Project, outside its checkout, and saved only once the environment check passes with it.
 */
export interface ProjectEnvironment {
  /** Variables set, in this order, over any inherited one of the same name. */
  readonly set: readonly ProjectVariable[];
  /** Inherited variables removed. */
  readonly unset: readonly string[];
  /** Folders put in front of PATH, in this order. */
  readonly prependPath: readonly string[];
}

/** A Project's environment until its first environment check: the inherited one, unchanged. */
export const UNCHANGED_ENVIRONMENT: ProjectEnvironment = { set: [], unset: [], prependPath: [] };

/**
 * The environment as it is kept: names and folders without the spaces around them, and without
 * rows left blank. Values stay as given, since a space in one may matter.
 */
export function trimmedEnvironment(environment: ProjectEnvironment): ProjectEnvironment {
  return {
    set: environment.set
      .map(({ name, value }) => ({ name: name.trim(), value }))
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
  for (const { name, value } of environment.set) {
    const problem = variableNameProblem(name);
    if (problem) problems.push(problem);
    if (value.includes("\0")) problems.push(`The value of ${name} has a NUL character.`);
  }
  const setNames = environment.set.map((variable) => variable.name);
  const repeated = setNames.filter((each, index) => setNames.indexOf(each) !== index);
  for (const name of new Set(repeated)) problems.push(`${name} is set more than once.`);
  for (const name of environment.unset) {
    const problem = variableNameProblem(name);
    if (problem) problems.push(problem);
  }
  return problems;
}

function variableNameProblem(name: string): string | undefined {
  if (name === "") return "Give each variable a name.";
  if (/[=\0]/.test(name)) return `A variable's name can't have "=" in it: ${name}.`;
  return undefined;
}

export function sameEnvironment(one: ProjectEnvironment, other: ProjectEnvironment): boolean {
  return (
    sameList(one.set, other.set, (a, b) => a.name === b.name && a.value === b.value) &&
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
