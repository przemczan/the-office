import type { AgentAction } from "./agent-action.js";
import { gitChange, isGit, READ_ONLY_GIT_COMMANDS } from "./git-commands.js";
import type { CommandPermission } from "./permission-profile.js";
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

/** Whether a tool call may run; a refusal says why, in words the Agent reads (spec §6). */
export type ToolDecision =
  { readonly allowed: true } | { readonly allowed: false; readonly reason: string };

/** What only The Office writes in a worktree: git's records and the engine's project settings. */
const PROTECTED_NAMES: ReadonlySet<string> = new Set([".git", ".claude", ".mcp.json"]);

/** Where output written to it goes nowhere: Bash's and cmd.exe's null device, PowerShell's $null. */
const NULL_DEVICES: ReadonlySet<string> = new Set(["/dev/null", "nul", "$null"]);

const ALLOWED: ToolDecision = { allowed: true };

const READ_ONLY_GIT = `read-only git (${READ_ONLY_GIT_COMMANDS.join(", ")})`;

/**
 * The Office rules, which no profile loosens (git, secrets, protected paths, the folders a session
 * reads and edits), and then the session's permission profile, applied as data (spec §6).
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
        return this.rules.profile.web ? ALLOWED : notAllowed("searching or fetching the web");
      case "read":
        return firstRefusal(action.paths, (path) => this.readRefusal(path));
      case "edit":
        return this.rules.profile.edit
          ? firstRefusal(action.paths, (path) => this.editRefusal(path))
          : notAllowed("editing files");
      case "command":
        return this.commandDecision(action.commandLine, action.dialect);
    }
  }

  private readRefusal(path: string): string | undefined {
    const { paths, workingFolder, readableFolders } = this.rules;
    const secret = this.secretRefusal(path);
    if (secret !== undefined) return secret;
    const resolved = paths.resolve(workingFolder, path);
    return [workingFolder, ...readableFolders].some((folder) => paths.isWithin(resolved, folder))
      ? undefined
      : `Refused by The Office: ${path} is outside this session's folders; read only inside ${workingFolder}.`;
  }

  private editRefusal(path: string): string | undefined {
    const { paths, workingFolder } = this.rules;
    const secret = this.secretRefusal(path);
    if (secret !== undefined) return secret;
    const resolved = paths.resolve(workingFolder, path);
    if (!paths.isWithin(resolved, workingFolder)) {
      return `Refused by The Office: ${path} is outside the worktree; edit only inside ${workingFolder}.`;
    }
    const names = paths.names(resolved).slice(paths.names(workingFolder).length);
    return names.some((name) => PROTECTED_NAMES.has(name))
      ? "Refused by The Office: .git, .claude and .mcp.json are The Office's to change; Agents never write there."
      : undefined;
  }

  private secretRefusal(word: string): string | undefined {
    const secret = this.secrets.namedBy(word);
    return secret === undefined
      ? undefined
      : `Refused by The Office: ${secret} holds the user's secrets or The Office's own files, which Agents never read or change.`;
  }

  private commandDecision(commandLine: string, dialect: ShellDialect): ToolDecision {
    let commands: SimpleCommand[];
    try {
      commands = simpleCommands(commandLine, dialect);
    } catch (error) {
      if (!(error instanceof UnreadableCommand)) throw error;
      return refused(`Refused by The Office: ${error.reason}; write the command out plainly.`);
    }
    const refusal =
      this.firstCommandRefusal(commands, (command) =>
        this.officeCommandRefusal(command, dialect),
      ) ??
      this.firstCommandRefusal(commands, (command) =>
        this.profileCommandRefusal(command, dialect, this.rules.profile.run),
      );
    return refusal === undefined ? ALLOWED : refused(refusal);
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

  /** Secrets and git, which hold under every profile. */
  private officeCommandRefusal(command: SimpleCommand, dialect: ShellDialect): string | undefined {
    for (const word of [...command.words, ...command.redirects.map(({ target }) => target)]) {
      const secret = this.secretRefusal(word);
      if (secret !== undefined) return secret;
    }
    const program = programWords(command, dialect);
    const change = isGit(program) ? gitChange(program) : undefined;
    return change === undefined
      ? undefined
      : `Refused by The Office: Agents never change git (${change}); The Office commits, branches and publishes. Only ${READ_ONLY_GIT} runs.`;
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
      return notAllowedReason(`commands other than ${READ_ONLY_GIT}`);
    }
    return projectCommands(permission.commandLines).some((allowed) => startsWith(program, allowed))
      ? undefined
      : notAllowedReason(
          `commands other than the Project's own (${permission.commandLines.join("; ")}) and ${READ_ONLY_GIT}`,
        );
  }
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

function notAllowed(what: string): ToolDecision {
  return refused(notAllowedReason(what));
}

function notAllowedReason(what: string): string {
  return `Not allowed in this session: ${what}.`;
}
