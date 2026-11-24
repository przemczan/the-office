import { Injectable } from "@nestjs/common";
import type { OutputMask } from "../domain/output-mask.js";
import type { Project } from "../domain/project.js";
import type { ProjectEnvironment, ProjectVariable } from "../domain/project-environment.js";
import type { FinishedCommand } from "../ports/command-runner.js";

/**
 * What a Project's run environment image is made from: its install, with its Install inputs and the
 * variables the install runs with as the image builds. A Task's and a test instance's alike.
 */
export interface RunEnvironmentInstall {
  readonly installCommand: string;
  /** The Project's Install inputs, relative to the worktree. */
  readonly installInputs: readonly string[];
  /** The Project's `set` variables, which the install runs with as the image builds. */
  readonly installVariables: readonly ProjectVariable[];
}

/** The Project's install as its run environment image takes it. */
export function runEnvironmentInstallOf(project: Project): RunEnvironmentInstall {
  return {
    installCommand: project.installCommand,
    installInputs: project.installInputs,
    installVariables: project.environment.set,
  };
}

/** A Task whose commands run in its run environment, and what its image is made from. */
export interface TaskInRunEnvironment extends RunEnvironmentInstall {
  readonly taskId: string;
  readonly projectId: string;
  /** The Task's worktree, mounted at the same path inside. */
  readonly worktree: string;
  /**
   * The git folder the worktree's repository shares, as git on the host names it, mounted
   * read-only at the same path inside so git reads the worktree's history there.
   */
  readonly repositoryGitFolder: string;
  /**
   * The folder of the file of the Task's earlier Stage runs, which a condition command reads
   * (spec §2.3): made before the run environment starts, mounted read-only at the same path inside.
   */
  readonly stageRunsFolder: string;
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
  /** Hides the Project's Secret variables in the output, the file written as it runs too. */
  readonly mask: OutputMask;
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
  /**
   * A condition command, which reads the Task's Stage runs' file: a run environment already running
   * without its folder mounted ends it `could-not-run`, with nothing run, saying to stop and start it.
   */
  readonly readsStageRuns?: boolean;
}

/**
 * The Tasks' run environments, as Run environments runs them. A run environment that can't be
 * made or started ends the command `could-not-run`, with why in its output: never on the host.
 */
export interface TaskRunEnvironmentRunner {
  /** The image the Task's commands run in now, built or not. */
  imageOf(task: TaskInRunEnvironment): Promise<string>;
  run(task: TaskInRunEnvironment, command: TaskRunEnvironmentCommand): Promise<FinishedCommand>;
  /**
   * Makes the Task's run environment ready and running with no command, stopping when idle as
   * usual; every reason it couldn't, in the UI's words, none once it runs.
   */
  start(task: TaskInRunEnvironment): Promise<readonly string[]>;
  /**
   * Whether the Task is its Project's "Set up the run environment" Task, whose commands run in
   * the run environment it sets up even while the Project's Run environment is Off.
   */
  setsUpRunEnvironment(taskId: string): Promise<boolean>;
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

  start(task: TaskInRunEnvironment): Promise<readonly string[]> {
    return this.runner().start(task);
  }

  setsUpRunEnvironment(taskId: string): Promise<boolean> {
    return this.runner().setsUpRunEnvironment(taskId);
  }

  private runner(): TaskRunEnvironmentRunner {
    if (!this.registered) throw new Error("No run environments are registered.");
    return this.registered;
  }
}
