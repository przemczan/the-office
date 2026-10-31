/**
 * A shell an Agent runs commands in, as its own engine tool. Each needs its own rules: a rule for
 * one does not reach the other (spec §6).
 */
export type AgentShell = "bash" | "powershell";

/** A program that runs one command line. */
export interface ShellProgram {
  /** For messages, such as `cmd.exe` or `sh`. */
  readonly name: string;
  /** How to run one command line in this shell, as the file, arguments and option to spawn it with. */
  invocation(commandLine: string): ShellInvocation;
}

/** The program behind an Agent's shell tool, for an engine that runs the tool itself. */
export interface AgentShellProgram extends ShellProgram {
  readonly shell: AgentShell;
}

export interface Shell extends ShellProgram {
  /**
   * Whether the shell could not run the command at all, as when its program isn't installed,
   * which says nothing about the Project's code, as opposed to the command failing.
   */
  couldNotRun(failed: FailedShellCommand): Promise<boolean>;
}

export interface ShellInvocation {
  readonly file: string;
  readonly arguments: readonly string[];
  /** Node's spawn option of the same name: cmd.exe parses its own command line, which Node's quoting would break. */
  readonly windowsVerbatimArguments: boolean;
}

/** A command line the shell ran, which exited with a code other than 0. */
export interface FailedShellCommand {
  readonly commandLine: string;
  readonly exitCode: number;
  /** The folder it ran in. */
  readonly folder: string;
  /** The variables it ran with. */
  readonly environment: Readonly<Record<string, string>>;
}
