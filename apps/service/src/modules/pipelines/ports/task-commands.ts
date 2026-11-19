import type { AgentCommand, AgentCommandEnd } from "../domain/agent-command.js";
import type { CommandRun, Installation, ScriptCommandRun } from "../domain/stage-command-run.js";

/** What a Project command does: a test command's run leaves the worktree as it was. */
export type ScriptCommandKind = "build" | "lint" | "test";

/** A Script Stage's command run: its kind, undefined when the Project has no such key, and its runs. */
export interface ScriptCommandResult {
  readonly kind: ScriptCommandKind | undefined;
  readonly runs: readonly ScriptCommandRun[];
}

/** Publish's before and after lines (spec §2.3 Defaults), by the Project's names for them. */
export type PublishingLine = "beforePublishingCommand" | "afterPublishingCommand";

/** Told when a command waits for a free run environment, and when that wait is over. */
export interface CommandWait {
  readonly started: () => Promise<void>;
  readonly ended: () => Promise<void>;
}

/** How a Project command is stopped, and told of a wait before it. */
export interface TaskCommandOptions {
  /** Stops the command, with everything it started, or its wait, with nothing run. */
  readonly signal: AbortSignal;
  readonly wait?: CommandWait;
}

/** An Agent's command's options: where its whole output goes beside how it is stopped. */
export interface AgentCommandOptions extends TaskCommandOptions {
  /** Made or replaced as it runs, its folder made if missing; it holds the install's output instead when that failed. */
  readonly outputFile: string;
}

/**
 * The Project commands The Office runs in the started Tasks' worktrees, with the Project's
 * environment, which Projects runs, on the host or in the Task's run environment, as the Project's
 * Run environment setting says; the composition root binds it. A command in a run environment may
 * wait for a free one first: its time limit counts from its start.
 */
export abstract class TaskCommands {
  /**
   * Installs the Project's dependencies in the Task's worktree, unless the install command, its
   * inputs, the environment and where it runs are as they were at its last install there that
   * passed.
   */
  abstract install(
    projectId: string,
    taskId: string,
    options: TaskCommandOptions,
  ): Promise<Installation>;

  /**
   * Runs a Script Stage's Project command, by its key (never install's), in the Task's worktree:
   * after each test-kind run the worktree is restored and the files it wrote are moved out of it,
   * to a folder named by the Stage run, and a failing test command runs once more. Returns the
   * command's kind and each run, in order; a key the Project lacks, or whose line is blank, gives
   * a run that couldn't run. A stop runs no other.
   */
  abstract runCommand(
    projectId: string,
    taskId: string,
    key: string,
    stageRunId: string,
    options: TaskCommandOptions,
  ): Promise<ScriptCommandResult>;

  /**
   * Runs the Project command a route's condition names (spec §2.3, "The Project-command
   * condition"), by its key, in the Task's worktree where a Script Stage's command runs, with its
   * time limit and the Project's own variables, `OFFICE_STAGE_RUNS_FILE` naming `stageRunsFile`.
   * It runs once, never again on failure, and whatever its kind the worktree is restored after it
   * and the files it wrote are moved out, to a folder named by `stageRunId`. A key the Project
   * lacks, a blank line, or a run environment started before it could read the file gives a run
   * that couldn't run.
   */
  abstract runConditionCommand(
    projectId: string,
    taskId: string,
    key: string,
    stageRunsFile: string,
    stageRunId: string,
    options: TaskCommandOptions,
  ): Promise<ScriptCommandResult>;

  /** The Project's before and after publishing lines, each blank when not set. */
  abstract publishingLines(projectId: string): Promise<Readonly<Record<PublishingLine, string>>>;

  /**
   * Runs a Publish's before or after publishing line in the Task's worktree, where a Script Stage's
   * command runs, with its time limit and the Project's own variables, `variables` set over them,
   * never The Office's credentials. What it changes stays in the worktree. Undefined, with nothing
   * run, when the line is blank.
   */
  abstract runPublishingLine(
    projectId: string,
    taskId: string,
    line: PublishingLine,
    variables: Readonly<Record<string, string>>,
    options: TaskCommandOptions,
  ): Promise<CommandRun | undefined>;

  /**
   * Runs a command for an Agent at work on the Task (spec §6): one of the Project's by its key, or
   * a command line it wrote, run as given, so the caller judges it first. It runs where a Script
   * Stage's command would, after an install when its inputs changed, and what it writes stays in
   * the worktree. A stop ends it, with everything it started, before this returns.
   */
  abstract runForAgent(
    projectId: string,
    taskId: string,
    command: AgentCommand,
    options: AgentCommandOptions,
  ): Promise<AgentCommandEnd>;
}
