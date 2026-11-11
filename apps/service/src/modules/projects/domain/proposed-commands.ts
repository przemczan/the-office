import {
  commandFieldsProblems,
  commandKeyProblems,
  commandOf,
  commandProblem,
  INSTALL_COMMAND_KEY,
  installInputsProblems,
  sameCommandFields,
  trimmedCommand,
  trimmedInstallInputs,
  type Project,
  type ProjectCommand,
  type ProjectCommandFields,
} from "./project.js";

/** A field as the Project had it when the Proposal was drafted (`from`), and as proposed (`to`). */
export interface ProposedValue<Value> {
  readonly from: Value;
  readonly to: Value;
}

/** A command added (`from` null), changed, or removed (`to` null), by its key. */
export interface ProposedCommand {
  readonly key: string;
  readonly from: ProjectCommandFields | null;
  readonly to: ProjectCommandFields | null;
}

/** What a Proposal of commands changes (spec §2.3), each field now and as proposed; the rest stay. */
export interface ProposedCommands {
  readonly installCommand?: ProposedValue<string> | undefined;
  readonly installInputs?: ProposedValue<readonly string[]> | undefined;
  readonly commands: readonly ProposedCommand[];
}

/** What Devops gives: only what changes, each one whole. */
export interface CommandsToPropose {
  readonly installCommand?: string | undefined;
  readonly installInputs?: readonly string[] | undefined;
  /** Each added, or changed by its key, whole. */
  readonly commands?: readonly ProjectCommand[] | undefined;
  /** The keys of the commands to remove. */
  readonly removeCommands?: readonly string[] | undefined;
}

/**
 * What of `given` differs from the Project, each with the Project's value now and the one given, so
 * a Proposal shows now and proposed and can tell when it went stale. A key given twice keeps the
 * last; a key also removed is removed.
 */
export function proposedCommands(project: Project, given: CommandsToPropose): ProposedCommands {
  const installCommand = given.installCommand?.trim();
  const installInputs = given.installInputs && trimmedInstallInputs(given.installInputs);
  const commands = new Map<string, ProposedCommand>();
  for (const command of (given.commands ?? []).map(trimmedCommand)) {
    const current = commandOf(project, command.key);
    const { key: _key, ...to } = command;
    if (current && sameCommandFields(current, to)) commands.delete(command.key);
    else {
      commands.set(command.key, {
        key: command.key,
        from: current ? fieldsOf(current) : null,
        to,
      });
    }
  }
  for (const key of given.removeCommands ?? []) {
    const current = commandOf(project, key);
    commands.set(key, { key, from: current ? fieldsOf(current) : null, to: null });
  }
  return {
    installCommand:
      installCommand !== undefined && installCommand !== project.installCommand
        ? { from: project.installCommand, to: installCommand }
        : undefined,
    installInputs:
      installInputs && !sameInstallInputs(installInputs, project.installInputs)
        ? { from: project.installInputs, to: installInputs }
        : undefined,
    commands: [...commands.values()],
  };
}

/**
 * Every reason a Proposal can't apply to the Project as it is: it changes nothing, a field it
 * changes changed since it was drafted (`from`), or a value it proposes breaks a rule the Project
 * page keeps too.
 */
export function proposedCommandsProblems(project: Project, proposed: ProposedCommands): string[] {
  const { installCommand, installInputs, commands } = proposed;
  if (!installCommand && !installInputs && commands.length === 0) {
    return [
      "Nothing changes: give the install command, install inputs or commands that change, each one whole.",
    ];
  }
  return [
    ...(installCommand ? installCommandChangeProblems(project, installCommand) : []),
    ...(installInputs ? installInputsChangeProblems(project, installInputs) : []),
    ...commands.flatMap((command, index) =>
      commandChangeProblems(project, command, commands.slice(0, index)),
    ),
  ];
}

function installCommandChangeProblems(
  project: Project,
  { from, to }: ProposedValue<string>,
): string[] {
  if (from !== project.installCommand)
    return ["The install command changed since this was proposed."];
  const problem = commandProblem(INSTALL_COMMAND_KEY, to);
  return problem ? [problem] : [];
}

function installInputsChangeProblems(
  project: Project,
  { from, to }: ProposedValue<readonly string[]>,
): string[] {
  if (!sameInstallInputs(from, project.installInputs)) {
    return ["The install inputs changed since this was proposed."];
  }
  return installInputsProblems(to);
}

function commandChangeProblems(
  project: Project,
  { key, from, to }: ProposedCommand,
  earlier: readonly ProposedCommand[],
): string[] {
  if (earlier.some((each) => each.key === key)) {
    return [`The ${key} command is proposed more than once.`];
  }
  const current = commandOf(project, key);
  if (from === null) {
    if (to === null) return [`The Project has no command with the key "${key}".`];
    if (current) return [`The Project got a ${key} command since this was proposed.`];
    return [
      ...commandKeyProblems(key, project.commands),
      ...commandFieldsProblems({ key, ...to }, { blankAllowed: false }),
    ];
  }
  if (!current || !sameCommandFields(current, from)) {
    return [`The ${key} command changed since this was proposed.`];
  }
  return to === null ? [] : commandFieldsProblems({ key, ...to }, { blankAllowed: false });
}

function fieldsOf({ name, kind, commandLine }: ProjectCommand): ProjectCommandFields {
  return { name, kind, commandLine };
}

function sameInstallInputs(one: readonly string[], other: readonly string[]): boolean {
  return one.length === other.length && one.every((input, index) => input === other[index]);
}
