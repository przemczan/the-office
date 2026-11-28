import { promptTemplate, type PromptTexts } from "../../prompt-templates/index.domain.js";

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

/** The Brief's words for the commands an Agent Stage's session may run. */
export const BRIEF_COMMANDS = promptTemplate({
  key: "pipelines.brief-commands",
  domain: "pipelines",
  name: "Commands in the Brief",
  description:
    "What an Agent Stage's Brief says the Agent may run: read-only git, the Project's commands, or any command.",
  variables: {
    git: {
      kind: "text",
      description:
        "The read-only git the Agent may always run, such as read-only git (git status).",
    },
    readOnlyGitOnly: {
      kind: "flag",
      description: "Whether the Agent's Role allows read-only git alone.",
    },
    projectCommands: {
      kind: "flag",
      description: "Whether the Agent's Role allows the Project's commands and read-only git.",
    },
    anything: {
      kind: "flag",
      description: "Whether the Agent's Role allows any command but git that changes something.",
    },
    narrowed: {
      kind: "flag",
      description: "Whether the Stage names which of the Project's commands it runs.",
    },
    noCommands: {
      kind: "flag",
      description: "Whether no Project command is left for the Agent to run in this Stage.",
    },
    commands: {
      kind: "list",
      description:
        "The Project's commands the Agent may run in this Stage, in the Project's order.",
      fields: {
        key: "The command's key.",
        name: "The command's name.",
        commandLine: "The command line, exactly as written.",
      },
    },
    hasOthers: {
      kind: "flag",
      description: "Whether the Project has set commands this narrowed Stage doesn't run.",
    },
    others: {
      kind: "text",
      description: "The keys of those commands, separated by commas.",
    },
  },
  text: `{{#readOnlyGitOnly}}
You may run {{git}} only.
{{/readOnlyGitOnly}}
{{#projectCommands}}
{{#noCommands}}
{{#narrowed}}None of the Project's commands is for this Stage{{/narrowed}}{{^narrowed}}The Project has no commands to run{{/narrowed}}, so you may run {{git}} only.
{{/noCommands}}
{{^noCommands}}
You may run the Project's commands, exactly as written, and {{git}}:

{{#commands}}
- {{key}} ({{name}}): \`{{commandLine}}\`
{{/commands}}
{{/noCommands}}
{{/projectCommands}}
{{#anything}}
You may run any command in the worktree, but no git command that changes anything: besides {{git}}, git is The Office's.
{{#narrowed}}

{{#noCommands}}
None of the Project's own commands is for this Stage.
{{/noCommands}}
{{^noCommands}}
Of the Project's own commands, run only these, by their key with run_project_command or exactly as written:

{{#commands}}
- {{key}} ({{name}}): \`{{commandLine}}\`
{{/commands}}
{{#hasOthers}}

The others ({{others}}) are not for this Stage.
{{/hasOthers}}
{{/noCommands}}
{{/narrowed}}
{{/anything}}`,
});

/**
 * The commands an Agent Stage's session may run, from one source, so the Brief names exactly what
 * the engine allows (research §11.6): an Agent not told is refused and asks a needless Decision.
 * The Project's own commands are `stageProjectCommands`, each by its key and name; its install
 * isn't among them, as it is a Hard switch's (spec §6). Under anything the shell stays free, so a
 * narrowing only tells the Agent which of the Project's commands are this Stage's.
 */
export function allowedCommands(
  prompts: PromptTexts,
  run: RunPermission,
  projectCommands: readonly NamedCommand[],
  narrowing: readonly string[] | undefined,
  readOnlyGit: readonly string[],
): AllowedCommands {
  const commands = stageProjectCommands(projectCommands, narrowing);
  const others = projectCommands
    .filter(
      ({ key, commandLine }) => commandLine !== "" && !commands.some((kept) => kept.key === key),
    )
    .map(({ key }) => key);
  // The text's lines each end in a line break, which the words don't keep.
  const words = prompts
    .render(BRIEF_COMMANDS, {
      git: `read-only git (${readOnlyGit.map((command) => `git ${command}`).join(", ")})`,
      readOnlyGitOnly: run === "read-only-git",
      projectCommands: run === "project-commands",
      anything: run === "anything",
      narrowed: narrowing !== undefined,
      noCommands: commands.length === 0,
      commands,
      hasOthers: others.length > 0,
      others: others.join(", "),
    })
    .trimEnd();
  switch (run) {
    case "read-only-git":
      return { permission: { kind: "read-only-git" }, words };
    case "project-commands":
      return {
        permission: {
          kind: "project-commands",
          commandLines: commands.map(({ commandLine }) => commandLine),
        },
        words,
      };
    case "anything":
      return { permission: { kind: "anything" }, words };
  }
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
