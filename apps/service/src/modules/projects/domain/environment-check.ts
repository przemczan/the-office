import type { CommandRun } from "./command-run.js";
import type { ProjectCommand } from "./project.js";
import type { ProjectEnvironment } from "./project-environment.js";

export type CheckState = "waiting" | "running" | "passed" | "failed" | "skipped";

/** A check's command as it is kept: the whole output is only for the Stage history. */
export type CheckedCommandRun = Omit<CommandRun, "wholeOutput">;

/** Where the check's worktree started. */
export interface CheckedBase {
  readonly commit: string;
  /** The remote branch fetched, such as `origin/main`, or undefined when the base branch tracks none. */
  readonly fetchedFrom: string | undefined;
}

/** That a fresh worktree of the freshly fetched base branch, or of the Task's branch, opens. */
export interface WorktreeCheck {
  readonly step: "worktree";
  readonly state: CheckState;
  readonly base?: CheckedBase;
  /** Why it failed, in git's words. */
  readonly problem?: string;
}

/** That the install command passes in that worktree. */
export interface InstallCheck {
  readonly step: "install";
  readonly state: CheckState;
  /** As it was when the check started, so a command changed meanwhile doesn't mix in. */
  readonly commandLine: string;
  readonly run?: CheckedCommandRun;
}

/**
 * That one of the Project's commands passes in that worktree, run once. Its key, name, kind and
 * command line are as they were when the check started, so a command changed meanwhile doesn't mix
 * in.
 */
export interface CommandCheck extends Omit<ProjectCommand, "rerunCommandLine"> {
  readonly step: "command";
  readonly state: CheckState;
  readonly run?: CheckedCommandRun;
}

export type Check = WorktreeCheck | InstallCheck | CommandCheck;

/** How the check ended: "stopped" when The Office shut down during it. */
export type EnvironmentCheckState = "running" | "passed" | "failed" | "stopped";

/**
 * A try of an environment in a fresh worktree of the base branch, or of a Task's branch (spec
 * §5.5): a worktree, then install, then each of the Project's commands in its order. The
 * environment is saved only when every check passes.
 */
export interface EnvironmentCheck {
  readonly projectId: string;
  /**
   * The Task whose branch it checks, in the Task's run environment when its commands run there;
   * undefined for the base branch.
   */
  readonly taskId?: string;
  /** The Project's saved environment as the check started, which may have changed since. */
  readonly environment: ProjectEnvironment;
  readonly state: EnvironmentCheckState;
  /** The worktree's check, install's, then one for each of the Project's commands in its order. */
  readonly checks: readonly Check[];
  readonly startedAt: Date;
  readonly finishedAt: Date | undefined;
}
