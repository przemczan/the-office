/** Which commands a Role's Agents may run, as their Role card says (spec §6). */
export type RunPermission = "read-only-git" | "project-commands" | "anything";

/** The same, as the engine enforces it: the Project's own commands by their command lines. */
export type CommandPermission =
  | { readonly kind: "read-only-git" }
  | { readonly kind: "project-commands"; readonly commandLines: readonly string[] }
  | { readonly kind: "anything" };

/** One of the Project's commands besides install, as the Brief names it. */
export interface NamedCommand {
  readonly key: string;
  readonly name: string;
  readonly commandLine: string;
}

/** What an Agent Stage's session may run: what the engine enforces, and the Brief's words for it. */
export interface AllowedCommands {
  readonly permission: CommandPermission;
  readonly words: string;
}

/** Install's key: it runs by its key under its own Hard switch, never narrowed by a Stage. */
const INSTALL_COMMAND_KEY = "install";

/**
 * The Project's commands an Agent Stage may run, in the Project's order: every set one, kept to the
 * Stage's narrowing when it has one (spec §2.3). A key the Project lacks, or one left blank, adds
 * nothing, so a narrowing never widens the Role card's.
 */
export function stageProjectCommands(
  projectCommands: readonly NamedCommand[],
  narrowing: readonly string[] | undefined,
): NamedCommand[] {
  return projectCommands.filter(
    ({ key, commandLine }) => commandLine !== "" && (narrowing?.includes(key) ?? true),
  );
}

/**
 * The commands an Agent Stage's session may run, from one source, so the Brief names exactly what
 * the engine allows (research §11.6): an Agent not told is refused and asks a needless Decision.
 * The Project's own commands are `stageProjectCommands`, each by its key and name; its install
 * isn't among them, as it is a Hard switch's (spec §6). Under anything the shell stays free, so a
 * narrowing only tells the Agent which of the Project's commands are this Stage's.
 */
export function allowedCommands(
  run: RunPermission,
  projectCommands: readonly NamedCommand[],
  narrowing: readonly string[] | undefined,
  readOnlyGit: readonly string[],
): AllowedCommands {
  const git = `read-only git (${readOnlyGit.map((command) => `git ${command}`).join(", ")})`;
  const commands = stageProjectCommands(projectCommands, narrowing);
  switch (run) {
    case "read-only-git":
      return { permission: { kind: "read-only-git" }, words: `You may run ${git} only.` };
    case "project-commands":
      return {
        permission: {
          kind: "project-commands",
          commandLines: commands.map(({ commandLine }) => commandLine),
        },
        words:
          commands.length === 0
            ? `${narrowing === undefined ? "The Project has no commands to run" : "None of the Project's commands is for this Stage"}, so you may run ${git} only.`
            : `You may run the Project's commands, exactly as written, and ${git}:\n\n${commandLines(commands)}`,
      };
    case "anything": {
      const anything = `You may run any command in the worktree, but no git command that changes anything: besides ${git}, git is The Office's.`;
      return {
        permission: { kind: "anything" },
        words:
          narrowing === undefined
            ? anything
            : `${anything}\n\n${narrowedProjectCommandsWords(commands, projectCommands)}`,
      };
    }
  }
}

/** Under anything, which of the Project's commands a narrowed Stage runs, and which it doesn't. */
function narrowedProjectCommandsWords(
  commands: readonly NamedCommand[],
  projectCommands: readonly NamedCommand[],
): string {
  const others = projectCommands
    .filter(
      ({ key, commandLine }) => commandLine !== "" && !commands.some((kept) => kept.key === key),
    )
    .map(({ key }) => key);
  const run =
    commands.length === 0
      ? "None of the Project's own commands is for this Stage."
      : `Of the Project's own commands, run only these, by their key with run_project_command or exactly as written:\n\n${commandLines(commands)}`;
  return others.length === 0 || commands.length === 0
    ? run
    : `${run}\n\nThe others (${others.join(", ")}) are not for this Stage.`;
}

function commandLines(commands: readonly NamedCommand[]): string {
  return commands
    .map(({ key, name, commandLine }) => `- ${key} (${name}): \`${commandLine}\``)
    .join("\n");
}

/**
 * Why an Agent may not run the Project's command `key` in this Stage, or undefined when it may: a
 * key outside the Stage's narrowing is refused, naming those it may run. Install is never refused
 * here, nor a key while the Stage keeps every command; a key the Project lacks is answered apart.
 */
export function commandKeyRefusal(
  key: string,
  projectCommands: readonly NamedCommand[],
  narrowing: readonly string[] | undefined,
): string | undefined {
  if (narrowing === undefined || key === INSTALL_COMMAND_KEY || narrowing.includes(key)) {
    return undefined;
  }
  const keys = stageProjectCommands(projectCommands, narrowing).map((command) => command.key);
  const mayRun = keys.length === 0 ? "none of the Project's commands" : keys.join(", ");
  return `The ${key} command isn't one this Stage may run; it may run ${mayRun}.`;
}
