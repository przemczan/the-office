import { Injectable } from "@nestjs/common";
import type { ProjectEnvironment } from "../domain/project-environment.js";
import type { FinishedCommand } from "../ports/command-runner.js";

/** A Task whose commands run in its run environment, and what its image is made from. */
export interface TaskInRunEnvironment {
  readonly taskId: string;
  readonly projectId: string;
  /** The Task's worktree, mounted at the same path inside. */
  readonly worktree: string;
  readonly installCommand: string;
  /** The Project's Install inputs, relative to the worktree. */
  readonly installInputs: readonly string[];
}

/** Told when a command waits for a free run environment, and when that wait is over. */
export interface CommandWait {
  readonly started: () => Promise<void>;
  readonly ended: () => Promise<void>;
}

/** A Project command to run in a Task's run environment. */
export interface TaskRunEnvironmentCommand {
  readonly commandLine: string;
  /** The Project's own: none of the service's variables reach the run environment. */
  readonly environment: ProjectEnvironment;
  /** Counted from when the command starts, never from a wait before it. */
  readonly timeoutMs: number;
  /** Ends a wait at once, with nothing run, or the command running. */
  readonly signal?: AbortSignal;
  readonly wait?: CommandWait;
  /**
   * Where its whole output goes as it runs, kept after it; the run environment's own output, if
   * it has to start first, goes elsewhere. Undefined writes it to a file of the runner's own.
   */
  readonly outputFile?: string;
}

/**
 * The Tasks' run environments, as Run environments runs them. A run environment that can't be
 * made or started ends the command `could-not-run`, with why in its output: never on the host.
 */
export interface TaskRunEnvironmentRunner {
  /** The image the Task's commands run in now, built or not. */
  imageOf(task: TaskInRunEnvironment): Promise<string>;
  run(task: TaskInRunEnvironment, command: TaskRunEnvironmentCommand): Promise<FinishedCommand>;
}

/**
 * Run environments' runner, given as that module starts: it reads the Project's setting through
 * Projects, so Projects can't ask it directly (the module template's registry).
 */
@Injectable()
export class TaskRunEnvironments implements TaskRunEnvironmentRunner {
  private registered: TaskRunEnvironmentRunner | undefined;

  register(runner: TaskRunEnvironmentRunner): void {
    this.registered = runner;
  }

  imageOf(task: TaskInRunEnvironment): Promise<string> {
    return this.runner().imageOf(task);
  }

  run(task: TaskInRunEnvironment, command: TaskRunEnvironmentCommand): Promise<FinishedCommand> {
    return this.runner().run(task, command);
  }

  private runner(): TaskRunEnvironmentRunner {
    if (!this.registered) throw new Error("No run environments are registered.");
    return this.registered;
  }
}
