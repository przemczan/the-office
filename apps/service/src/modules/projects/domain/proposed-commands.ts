import {
  commandFieldsProblems,
  commandKeyProblems,
  commandOf,
  commandProblem,
  INSTALL_COMMAND_KEY,
  installInputsProblems,
  PUBLISHING_LINE_NAMES,
  PUBLISHING_LINES,
  publishingLineProblem,
  sameCommandFields,
  trimmedCommand,
  trimmedInstallInputs,
  type Project,
  type ProjectCommand,
  type ProjectCommandFields,
  type PublishingLine,
} from "./project.js";
import type { CommandEdit } from "./project-changes.js";

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
  readonly beforePublishingCommand?: ProposedValue<string> | undefined;
  readonly afterPublishingCommand?: ProposedValue<string> | undefined;
  readonly commands: readonly ProposedCommand[];
}

/** What Devops gives: only what changes, each one whole. */
export interface CommandsToPropose {
  readonly installCommand?: string | undefined;
  readonly installInputs?: readonly string[] | undefined;
  /** Blank clears it. */
  readonly beforePublishingCommand?: string | undefined;
  /** Blank clears it. */
  readonly afterPublishingCommand?: string | undefined;
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
    beforePublishingCommand: proposedLine(project, "beforePublishingCommand", given),
    afterPublishingCommand: proposedLine(project, "afterPublishingCommand", given),
    commands: [...commands.values()],
  };
}

function proposedLine(
  project: Project,
  line: PublishingLine,
  given: CommandsToPropose,
): ProposedValue<string> | undefined {
  const to = given[line]?.trim();
  return to !== undefined && to !== project[line] ? { from: project[line], to } : undefined;
}

/** The edits a Proposal makes once applied, in the order the Project page would save them. */
export function commandEditsOfProposed(proposed: ProposedCommands): CommandEdit[] {
  const { installCommand, installInputs } = proposed;
  return [
    ...(installCommand ? [{ kind: "install", commandLine: installCommand.to } as const] : []),
    ...(installInputs ? [{ kind: "installInputs", inputs: installInputs.to } as const] : []),
    ...PUBLISHING_LINES.flatMap((line) => {
      const change = proposed[line];
      return change ? [{ kind: "publishingLine", line, commandLine: change.to } as const] : [];
    }),
    ...proposed.commands.map(({ key, from, to }): CommandEdit => {
      if (to === null) return { kind: "remove", key };
      return from === null
        ? { kind: "add", command: { key, ...to } }
        : { kind: "change", key, fields: to };
    }),
  ];
}

/** The keys of the commands the Proposal removes. */
export function removedCommandKeys({ commands }: ProposedCommands): string[] {
  return commands.filter(({ to }) => to === null).map(({ key }) => key);
}

/**
 * Every reason a Proposal can't apply to the Project as it is: it changes nothing, a field it
 * changes changed since it was drafted (`from`), or a value it proposes breaks a rule the Project
 * page keeps too.
 */
export function proposedCommandsProblems(project: Project, proposed: ProposedCommands): string[] {
  const { installCommand, installInputs, commands } = proposed;
  const changedLines = PUBLISHING_LINES.filter((line) => proposed[line]);
  if (!installCommand && !installInputs && changedLines.length === 0 && commands.length === 0) {
    return [
      "Nothing changes: give the install command, install inputs, before or after publishing lines or commands that change, each one whole.",
    ];
  }
  return [
    ...(installCommand ? installCommandChangeProblems(project, installCommand) : []),
    ...(installInputs ? installInputsChangeProblems(project, installInputs) : []),
    ...changedLines.flatMap((line) => publishingLineChangeProblems(project, line, proposed[line])),
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

function publishingLineChangeProblems(
  project: Project,
  line: PublishingLine,
  proposed: ProposedValue<string> | undefined,
): string[] {
  if (!proposed) return [];
  if (proposed.from !== project[line]) {
    return [`The ${PUBLISHING_LINE_NAMES[line]} line changed since this was proposed.`];
  }
  const problem = publishingLineProblem(line, proposed.to);
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

function fieldsOf({
  name,
  kind,
  commandLine,
  rerunCommandLine,
}: ProjectCommand): ProjectCommandFields {
  return { name, kind, commandLine, rerunCommandLine };
}

function sameInstallInputs(one: readonly string[], other: readonly string[]): boolean {
  return one.length === other.length && one.every((input, index) => input === other[index]);
}
