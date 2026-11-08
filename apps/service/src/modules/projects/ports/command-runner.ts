import type { CommandOutcome } from "../domain/command-run.js";

export interface CommandToRun {
  readonly commandLine: string;
  /** The folder it runs in. */
  readonly folder: string;
  /** Every variable it runs with: it inherits none. */
  readonly environment: Readonly<Record<string, string>>;
  /** How long it may take before it is ended, with everything it started. */
  readonly timeoutMs: number;
  /** Ends it, with everything it started, when aborted. */
  readonly signal?: AbortSignal;
  /** Where its whole output is written too, as it comes; the file is made or replaced. */
  readonly outputFile?: string;
  /**
   * Runs it in the Bash Agents have, not the Project's shell: a line an Agent wrote, judged by its
   * Office rules as that Bash would run it, so cmd.exe can't read it another way.
   */
  readonly inAgentBash?: boolean;
}

export interface FinishedCommand {
  readonly outcome: CommandOutcome;
  /** Undefined when it never exited by itself. */
  readonly exitCode: number | undefined;
  readonly durationMs: number;
  /** What it printed to standard output and error, as it came; only the end of a long output. */
  readonly output: string;
  /** How much of a long output's start isn't in `output`. */
  readonly droppedOutputBytes: number;
}

/** Runs a command line in the platform's shell. */
export abstract class CommandRunner {
  abstract run(command: CommandToRun): Promise<FinishedCommand>;
}
