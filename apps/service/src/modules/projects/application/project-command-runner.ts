import { Injectable } from "@nestjs/common";
import { currentOperatingSystem } from "../../../platform/os/current-operating-system.js";
import { filteredOutput, wholeOutputOf, type CommandRun } from "../domain/command-run.js";
import type { ProjectEnvironment } from "../domain/project-environment.js";
import { CommandRunner } from "../ports/command-runner.js";
import { commandEnvironment } from "./command-environment.js";

export interface ProjectCommand {
  readonly commandLine: string;
  /** The folder it runs in: a worktree of the Project. */
  readonly folder: string;
  /** The Project's, or one the environment check tries before it is saved. */
  readonly environment: ProjectEnvironment;
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
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
  }: ProjectCommand): Promise<CommandRun> {
    const finished = await this.runner.run({
      commandLine,
      folder,
      environment: this.variablesFor(environment),
      timeoutMs,
      signal,
    });
    return {
      commandLine,
      outcome: finished.outcome,
      exitCode: finished.exitCode,
      durationMs: finished.durationMs,
      output: filteredOutput(finished.output),
      wholeOutput: wholeOutputOf(finished.output, finished.droppedOutputBytes),
    };
  }

  /** The variables a Project with this environment runs its commands with. */
  variablesFor(environment: ProjectEnvironment): Record<string, string> {
    return commandEnvironment(process.env, environment, this.operatingSystem);
  }
}
