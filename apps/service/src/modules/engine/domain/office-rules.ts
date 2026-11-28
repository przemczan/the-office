import type { AgentAction } from "./agent-action.js";
import { officeReach } from "./office-reach-commands.js";
import { containerRuntimeReach, RUN_PROJECT_COMMAND_TOOL } from "./container-runtime-commands.js";
import { directoryChange } from "./directory-change.js";
import { gitChange, isGit, READ_ONLY_GIT_COMMANDS } from "./git-commands.js";
import type { ApprovalSetting, CommandPermission } from "./permission-profile.js";
import { SecretPaths } from "./secret-paths.js";
import type { SessionRules } from "./session-rules.js";
import {
  programName,
  programWords,
  simpleCommands,
  UnreadableCommand,
  type ShellDialect,
  type SimpleCommand,
} from "./shell-commands.js";
import { writtenPaths } from "./written-paths.js";

/**
 * Whether a tool call may run; a refusal says why, in words the Agent reads (spec §6). A call
 * whose setting asks for someone's approval is refused unless that approval is sought (`approval`).
 */
export type ToolDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: string; readonly approval?: ApprovalSetting };

/** What only The Office writes in a worktree: git's records and the engine's project settings. */
const PROTECTED_NAMES: ReadonlySet<string> = new Set([".git", ".claude", ".mcp.json"]);

/**
 * Files protected by a folder and a name together, anywhere in a worktree: the Gemini CLI ranks a
 * folder's `.gemini/settings.json` above the session's own settings, so one could turn the Office
 * rules off (spec 5.4.7); the rest of `.gemini/` stays the Agents'.
 */
const PROTECTED_FILES: readonly (readonly [folder: string, name: string])[] = [
  [".gemini", "settings.json"],
];

/**
 * The repository's run environment definition folder, which Agents write only through The Office's
 * tool, which checks it first; the engine's own protection refuses it too, without a reason.
 */
const RUN_ENVIRONMENT_DEFINITION_FOLDER = ".devcontainer";

/**
 * The Office tool an Agent Stage, or a Consultation on a Task, writes the run environment definition
 * with, offered to Roles with the Run environment capability, which the refusal points to.
 * Pipelines registers it.
 */
export const WRITE_RUN_ENVIRONMENT_DEFINITION_TOOL = "write_run_environment_definition";

/** Where output written to it goes nowhere: Bash's and cmd.exe's null device, PowerShell's $null. */
const NULL_DEVICES: ReadonlySet<string> = new Set(["/dev/null", "nul", "$null"]);

/** What is left of a variable or a substitution in a word once the session's variables are expanded. */
const UNREAD_PARTS = /[$`%]/;

const ALLOWED: ToolDecision = { allowed: true };

const READ_ONLY_GIT = `read-only git (${READ_ONLY_GIT_COMMANDS.join(", ")})`;

const READ_WITH_TOOLS = "read files with Read and search them with Grep";

/**
 * The read-only git profile's rule in the words of a session's instructions, matching its refusal:
 * Agents on it reached for head and grep through the shell (task 31's live run).
 */
export const READ_ONLY_SHELL_RULE = `the shell runs only ${READ_ONLY_GIT} and refuses every other command, in a pipe too (git show | head is refused), so ${READ_WITH_TOOLS}`;

/**
 * The Office rules, which no profile loosens (git, the container runtime, secrets, protected paths,
 * the folders a session reads and edits), and then the session's permission profile, applied as
 * data (spec §6). A session reaching the workstation is held to the secrets alone, and then its
 * profile.
 */
export class OfficeRules {
  private readonly secrets: SecretPaths;

  constructor(private readonly rules: SessionRules) {
    this.secrets = new SecretPaths(rules);
  }

  decide(action: AgentAction): ToolDecision {
    switch (action.kind) {
      case "engine":
      case "office-tool":
        return ALLOWED;
      case "unavailable":
        return refused(`Not available in The Office: the ${action.tool} tool.`);
      case "web":
        return this.rules.profile.web ? ALLOWED : this.notAllowed("searching or fetching the web");
      case "read":
        return firstRefusal(action.paths, (path) => this.readRefusal(path));
      case "edit":
        return this.rules.profile.edit
          ? firstRefusal(action.paths, (path) => this.editRefusal(path))
          : this.notAllowed("editing files");
      case "command":
        return this.commandDecision(action.commandLine, action.dialect);
      case "mcp-tool":
        return this.mcpToolDecision(action.server, action.tool);
    }
  }

  /** Each tool of the session's MCP servers as its setting says; any other is not The Office's. */
  private mcpToolDecision(server: string, tool: string): ToolDecision {
    const setting = this.rules.profile.mcpTools[`${server}/${tool}`];
    if (!setting) return refused(`Not available in The Office: the ${server}/${tool} MCP tool.`);
    switch (setting.kind) {
      case "allowed":
        return ALLOWED;
      case "never":
        return refused(notAllowedReason(`the ${server}/${tool} MCP tool`));
      case "consult":
      case "ask-me":
        return {
          allowed: false,
          reason: `The ${server}/${tool} MCP tool runs only on approval, which this session can't ask for.`,
          approval: setting,
        };
    }
  }

  private readRefusal(path: string): string | undefined {
    const { paths, workingFolder, readableFolders } = this.rules;
    const secret = this.secretRefusal(path);
    if (secret !== undefined || this.rules.workstation) return secret;
    if (this.rules.readsEngineTranscripts && this.secrets.isEngineTranscript(path))
      return undefined;
    const resolved = paths.resolve(workingFolder, path);
    return [workingFolder, ...readableFolders].some((folder) => paths.isWithin(resolved, folder))
      ? undefined
      : this.advised(
          `Refused by The Office: ${path} is outside this session's folders; read only inside ${workingFolder}.`,
        );
  }

  private editRefusal(path: string): string | undefined {
    const { paths, workingFolder } = this.rules;
    const secret = this.secretRefusal(path);
    if (secret !== undefined || this.rules.workstation) return secret;
    const resolved = paths.resolve(workingFolder, path);
    if (!paths.isWithin(resolved, workingFolder)) {
      return this.advised(
        `Refused by The Office: ${path} is outside the worktree; edit only inside ${workingFolder}.`,
      );
    }
    return this.protectedPathRefusal(resolved);
  }

  /**
   * Why Agents never write at `resolved`, a path inside the worktree, whatever writes it (Edit and
   * Write, or a command): a protected path, or the run environment definition.
   */
  private protectedPathRefusal(resolved: string): string | undefined {
    const { paths, workingFolder } = this.rules;
    const names = paths.names(resolved).slice(paths.names(workingFolder).length);
    if (names.some((name) => PROTECTED_NAMES.has(name))) {
      return this.advised(
        "Refused by The Office: .git, .claude and .mcp.json are The Office's to change; Agents never write there.",
      );
    }
    if (isProtectedFile(names)) {
      return this.advised(
        "Refused by The Office: .gemini/settings.json would rank above The Office's settings on a Gemini CLI engine, so Agents never write it; the rest of .gemini/ is open to edits.",
      );
    }
    return names[0] === RUN_ENVIRONMENT_DEFINITION_FOLDER
      ? this.advised(
          `Refused by The Office: ${RUN_ENVIRONMENT_DEFINITION_FOLDER}/ is written only with ${WRITE_RUN_ENVIRONMENT_DEFINITION_TOOL}, which checks the run environment definition first; only Roles with the Run environment capability have it, in an Agent Stage or a Consultation on a Task.`,
        )
      : undefined;
  }

  /**
   * A command writing a protected path or the run environment definition, as Edit and Write may
   * not: a redirect's target, or a word of a program that writes the files it names
   * (`writtenPaths`), wherever along `directories` it runs. A program that writes by its own code,
   * such as `node -e`, isn't read: the rules guard against an Agent's mistakes (spec §6).
   */
  private protectedWriteRefusal(
    command: SimpleCommand,
    dialect: ShellDialect,
    directories: readonly string[],
  ): string | undefined {
    const { paths, workingFolder } = this.rules;
    const written = [
      ...command.redirects
        .filter(({ target, writes }) => writes && !NULL_DEVICES.has(target.toLowerCase()))
        .map(({ target }) => target),
      ...writtenPaths(programWords(command, dialect)),
    ];
    for (const word of written) {
      const expanded = this.secrets.expand(word);
      // A variable the session doesn't set, or a substitution: where it writes is not read.
      if (UNREAD_PARTS.test(expanded)) continue;
      for (const directory of directories) {
        const resolved = paths.resolve(directory, expanded);
        if (!paths.isWithin(resolved, workingFolder)) continue;
        const refusal = this.protectedPathRefusal(resolved);
        if (refusal !== undefined) return refusal;
      }
    }
    return undefined;
  }

  private secretRefusal(word: string, directory?: string): string | undefined {
    const secret = this.secrets.namedBy(word, directory);
    if (secret === undefined) return undefined;
    return this.rules.workstation
      ? `Refused by The Office: ${secret} holds secrets, which Agents never read or change, even with changes allowed.`
      : `Refused by The Office: ${secret} holds the user's secrets or The Office's own files, which Agents never read or change.`;
  }

  /** The refusal with what the Agent can do about it, when the session says. */
  private advised(reason: string): string {
    const { refusalAdvice } = this.rules;
    return refusalAdvice === undefined ? reason : `${reason} ${refusalAdvice}`;
  }

  private notAllowed(what: string): ToolDecision {
    return refused(this.advised(notAllowedReason(what)));
  }

  private commandDecision(commandLine: string, dialect: ShellDialect): ToolDecision {
    let commands: SimpleCommand[];
    try {
      commands = simpleCommands(commandLine, dialect);
    } catch (error) {
      if (!(error instanceof UnreadableCommand)) throw error;
      return refused(`Refused by The Office: ${error.reason}; write the command out plainly.`);
    }
    const officeRefusal = this.officeRefusalAlong(commands, dialect);
    if (officeRefusal !== undefined) return refused(officeRefusal);
    const profileRefusal = this.firstCommandRefusal(commands, (command) =>
      this.profileCommandRefusal(command, dialect, this.rules.profile.run),
    );
    return profileRefusal === undefined ? ALLOWED : refused(this.advised(profileRefusal));
  }

  private firstCommandRefusal(
    commands: readonly SimpleCommand[],
    refusalOf: (command: SimpleCommand) => string | undefined,
  ): string | undefined {
    for (const command of commands) {
      const refusal = refusalOf(command);
      if (refusal !== undefined) return refusal;
    }
    return undefined;
  }

  /** The Office's refusal of the first command that has one, following the line's `cd`s. */
  private officeRefusalAlong(
    commands: readonly SimpleCommand[],
    dialect: ShellDialect,
  ): string | undefined {
    let directories: readonly string[] = [this.rules.workingFolder];
    for (const command of commands) {
      const refusal = this.officeCommandRefusal(command, dialect, directories);
      if (refusal !== undefined) return refusal;
      directories = this.directoriesAfter(command, dialect, directories);
    }
    return undefined;
  }

  /**
   * Where the commands after this one may run. A `cd` in the line's own shell moves them; one in a
   * subshell or a pipeline may not last, so they may run in either place, and both are judged.
   */
  private directoriesAfter(
    command: SimpleCommand,
    dialect: ShellDialect,
    directories: readonly string[],
  ): readonly string[] {
    const change = directoryChange(command, dialect);
    if (change.kind === "none" || change.kind === "unknown") return directories;
    const target =
      change.kind === "home" ? this.rules.homeFolder : this.secrets.expand(change.path);
    // A variable the session doesn't set, or a substitution: where it goes is not read.
    if (UNREAD_PARTS.test(target)) return directories;
    const moved = directories.map((directory) => this.rules.paths.resolve(directory, target));
    return [...new Set(command.inMainShell ? moved : [...directories, ...moved])];
  }

  /**
   * Secrets, the container runtime and git, which hold under every profile, for a command run in any
   * of `directories`; only the secrets for a session reaching the workstation.
   */
  private officeCommandRefusal(
    command: SimpleCommand,
    dialect: ShellDialect,
    directories: readonly string[],
  ): string | undefined {
    for (const word of [...command.words, ...command.redirects.map(({ target }) => target)]) {
      for (const directory of directories) {
        const secret = this.secretRefusal(word, directory);
        if (secret !== undefined) return secret;
      }
    }
    const reached = this.officeReachRefusal(command);
    if (reached !== undefined) return reached;
    if (this.rules.workstation) return undefined;
    const outsideWrite = this.outsideWriteRefusal(command, directories);
    if (outsideWrite !== undefined) return outsideWrite;
    const protectedWrite = this.protectedWriteRefusal(command, dialect, directories);
    if (protectedWrite !== undefined) return protectedWrite;
    const program = programWords(command, dialect);
    const runtime = containerRuntimeReach(program, [
      ...command.words,
      ...command.redirects.map(({ target }) => target),
    ]);
    if (runtime !== undefined) {
      return this.advised(
        `Refused by The Office: Agents never reach the container runtime (${runtime}), which would reach the whole workstation; in a Stage, run the Project's commands, or a command line such as one test file, with ${RUN_PROJECT_COMMAND_TOOL}, which runs them in the Task's run environment.`,
      );
    }
    const change = isGit(program) ? gitChange(program) : undefined;
    return change === undefined
      ? undefined
      : this.advised(
          `Refused by The Office: Agents never change git (${change}); The Office commits, branches and publishes. Only ${READ_ONLY_GIT} runs.`,
        );
  }

  /** Refused to every session: a command naming the running Office's API port or its database. */
  private officeReachRefusal(command: SimpleCommand): string | undefined {
    const { officeReach: reach, officeToolsAdvice } = this.rules;
    if (reach === undefined) return undefined;
    const words = [...command.words, ...command.redirects.map(({ target }) => target)];
    const reached = officeReach(words, reach);
    if (reached === undefined) return undefined;
    return this.advised(
      [
        `Not allowed: this reaches The Office's own ${reached}. Change Office state with your Office tools.`,
        officeToolsAdvice,
      ]
        .filter(Boolean)
        .join(" "),
    );
  }

  /**
   * A command's output written to a file outside the worktree. The engine refuses it too, but in
   * words that don't tell the Agent the rule (task 30's problem C).
   */
  private outsideWriteRefusal(
    command: SimpleCommand,
    directories: readonly string[],
  ): string | undefined {
    const { paths, workingFolder } = this.rules;
    for (const { target, writes } of command.redirects) {
      if (!writes || NULL_DEVICES.has(target.toLowerCase())) continue;
      const expanded = this.secrets.expand(target);
      // A variable the session doesn't set, or a substitution: where it writes is not read.
      if (UNREAD_PARTS.test(expanded)) continue;
      if (
        directories.some(
          (directory) => !paths.isWithin(paths.resolve(directory, expanded), workingFolder),
        )
      ) {
        return this.advised(
          `Refused by The Office: ${target} is outside the worktree, and writes outside it are refused; keep a command's output in the shell, or write it inside ${workingFolder}.`,
        );
      }
    }
    return undefined;
  }

  private profileCommandRefusal(
    command: SimpleCommand,
    dialect: ShellDialect,
    permission: CommandPermission,
  ): string | undefined {
    if (permission.kind === "anything") return undefined;
    if (
      command.redirects.some(
        ({ target, writes }) => writes && !NULL_DEVICES.has(target.toLowerCase()),
      )
    ) {
      return notAllowedReason("writing a command's output to a file");
    }
    const program = programWords(command, dialect);
    if (program.length === 0 || isGit(program)) return undefined;
    if (permission.kind === "read-only-git") {
      return notAllowedReason(
        `commands other than ${READ_ONLY_GIT}, alone or in a pipe; ${READ_WITH_TOOLS} instead`,
      );
    }
    return projectCommands(permission.commandLines).some((allowed) => startsWith(program, allowed))
      ? undefined
      : notAllowedReason(
          `commands other than the Project's own (${permission.commandLines.join("; ")}) and ${READ_ONLY_GIT}`,
        );
  }
}

/** Whether a worktree path's names end in a protected file, as `.gemini/settings.json`. */
function isProtectedFile(names: readonly string[]): boolean {
  return PROTECTED_FILES.some(([folder, name]) => names.at(-1) === name && names.at(-2) === folder);
}

/**
 * The simple commands of a Project's command lines, which run in the platform's shell; Bash's
 * reading of them is close enough to cmd.exe's for matching.
 */
function projectCommands(commandLines: readonly string[]): (readonly string[])[] {
  return commandLines.flatMap((commandLine) =>
    simpleCommands(commandLine, "bash").map((command) => programWords(command, "bash")),
  );
}

/** Whether `program` runs `allowed`, with more arguments or none: word by word, the program by its name. */
function startsWith(program: readonly string[], allowed: readonly string[]): boolean {
  return (
    allowed.length > 0 &&
    allowed.length <= program.length &&
    allowed.every((word, index) =>
      index === 0 ? programName(word) === programName(program[0] ?? "") : word === program[index],
    )
  );
}

function firstRefusal(
  paths: readonly string[],
  refusalOf: (path: string) => string | undefined,
): ToolDecision {
  for (const path of paths) {
    const refusal = refusalOf(path);
    if (refusal !== undefined) return refused(refusal);
  }
  return ALLOWED;
}

function refused(reason: string): ToolDecision {
  return { allowed: false, reason };
}

function notAllowedReason(what: string): string {
  return `Not allowed in this session: ${what}.`;
}
