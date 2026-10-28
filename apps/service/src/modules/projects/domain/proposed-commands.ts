import {
  commandProblem,
  installInputsProblems,
  PROJECT_COMMAND_KEYS,
  trimmedInstallInputs,
  type Project,
  type ProjectCommands,
} from "./project.js";

/** The commands and install inputs a Proposal changes (spec §2.3), each one whole; the rest stay. */
export type ProjectCommandFields = Partial<ProjectCommands> & {
  readonly installInputs?: readonly string[];
};

/**
 * The fields of `given` that differ from the Project's, each with the Project's value now (`from`)
 * and the one given (`to`), so a Proposal shows now and proposed and can tell when it went stale.
 */
export function proposedCommandFields(
  project: Project,
  given: ProjectCommandFields,
): { readonly from: ProjectCommandFields; readonly to: ProjectCommandFields } {
  const from: { -readonly [Field in keyof ProjectCommandFields]: ProjectCommandFields[Field] } = {};
  const to: typeof from = {};
  for (const key of PROJECT_COMMAND_KEYS) {
    const commandLine = given[key]?.trim();
    if (commandLine === undefined || commandLine === project.commands[key]) continue;
    from[key] = project.commands[key];
    to[key] = commandLine;
  }
  if (given.installInputs) {
    const installInputs = trimmedInstallInputs(given.installInputs);
    if (!sameInstallInputs(installInputs, project.installInputs)) {
      from.installInputs = project.installInputs;
      to.installInputs = installInputs;
    }
  }
  return { from, to };
}

/**
 * Every reason a Proposal can't apply to the Project as it is: it changes nothing, a field it
 * rewrites changed since it was drafted (`from`), or a value it proposes breaks a rule.
 */
export function proposedCommandsProblems(
  project: Project,
  from: ProjectCommandFields,
  to: ProjectCommandFields,
): string[] {
  const keys = PROJECT_COMMAND_KEYS.filter((key) => to[key] !== undefined);
  if (keys.length === 0 && !to.installInputs) {
    return ["Nothing changes: give the commands or install inputs that change, each one whole."];
  }
  return [
    ...keys.flatMap((key) => {
      if (from[key] !== project.commands[key]) {
        return [`The ${key} command changed since this was proposed.`];
      }
      const problem = commandProblem(key, to[key] ?? "");
      return problem ? [problem] : [];
    }),
    ...(to.installInputs ? installInputsChangeProblems(project, from, to.installInputs) : []),
  ];
}

function installInputsChangeProblems(
  project: Project,
  from: ProjectCommandFields,
  installInputs: readonly string[],
): string[] {
  if (!from.installInputs || !sameInstallInputs(from.installInputs, project.installInputs)) {
    return ["The install inputs changed since this was proposed."];
  }
  return installInputsProblems(installInputs);
}

function sameInstallInputs(one: readonly string[], other: readonly string[]): boolean {
  return one.length === other.length && one.every((input, index) => input === other[index]);
}
