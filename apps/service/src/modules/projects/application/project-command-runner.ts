import { Injectable } from "@nestjs/common";
import { currentOperatingSystem } from "../../../platform/os/current-operating-system.js";
import { filteredOutput, wholeOutputOf, type CommandRun } from "../domain/command-run.js";
import { OutputMask } from "../domain/output-mask.js";
import type { ProjectEnvironment } from "../domain/project-environment.js";
import { CommandRunner, type FinishedCommand } from "../ports/command-runner.js";
import { commandEnvironment } from "./command-environment.js";

export interface ProjectCommand {
  readonly commandLine: string;
  /** The folder it runs in: a worktree of the Project. */
  readonly folder: string;
  /** The Project's, or one the environment check tries before it is saved. */
  readonly environment: ProjectEnvironment;
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
  /** Where its whole output is written too, as it comes. */
  readonly outputFile?: string;
  /** Runs it in the Bash Agents have, as a line an Agent wrote, rather than the Project's shell. */
  readonly inAgentBash?: boolean;
}

/** Runs every command The Office runs for a Project, with the Project's environment applied. */
@Injectable()
export class ProjectCommandRunner {
  private readonly operatingSystem = currentOperatingSystem();

  constructor(private readonly runner: CommandRunner) {}

  async run({
    commandLine,
    folder,
    environment,
    timeoutMs,
    signal,
    outputFile,
    inAgentBash,
  }: ProjectCommand): Promise<CommandRun> {
    const mask = OutputMask.of(environment);
    const finished = await this.runner.run({
      commandLine,
      folder,
      environment: this.variablesFor(environment),
      timeoutMs,
      signal,
      outputFile,
      mask,
      inAgentBash,
    });
    return commandRunOf(commandLine, finished, mask);
  }

  /** The variables a Project with this environment runs its commands with. */
  variablesFor(environment: ProjectEnvironment): Record<string, string> {
    return commandEnvironment(process.env, environment, this.operatingSystem);
  }
}

/**
 * A finished command as it is recorded, wherever it ran: its output filtered and kept whole, each
 * Secret variable's value hidden in both.
 */
export function commandRunOf(
  commandLine: string,
  finished: FinishedCommand,
  mask: OutputMask,
): CommandRun {
  const output = mask.mask(finished.output);
  return {
    commandLine,
    outcome: finished.outcome,
    exitCode: finished.exitCode,
    durationMs: finished.durationMs,
    output: filteredOutput(output),
    wholeOutput: wholeOutputOf(output, finished.droppedOutputBytes),
  };
}
