import type { CommandRun } from "./command-run.js";
import type { ProjectCommandKey } from "./project.js";
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

/** That a fresh worktree of the freshly fetched base branch opens. */
export interface WorktreeCheck {
  readonly step: "worktree";
  readonly state: CheckState;
  readonly base?: CheckedBase;
  /** Why it failed, in git's words. */
  readonly problem?: string;
}

/** That one of the Project's commands passes in that worktree. */
export interface CommandCheck {
  readonly step: ProjectCommandKey;
  readonly state: CheckState;
  /** As it was when the check started, so a command changed meanwhile doesn't mix in. */
  readonly commandLine: string;
  readonly run?: CheckedCommandRun;
}

export type Check = WorktreeCheck | CommandCheck;

/** How the check ended: "stopped" when The Office shut down during it. */
export type EnvironmentCheckState = "running" | "passed" | "failed" | "stopped";

/**
 * A try of an environment in a fresh worktree of the base branch (spec §5.5): a worktree, then
 * install, build, lint and test in order. The environment is saved only when every check passes.
 */
export interface EnvironmentCheck {
  readonly projectId: string;
  /** The environment tried, which may not be the Project's yet. */
  readonly environment: ProjectEnvironment;
  readonly state: EnvironmentCheckState;
  /** The worktree's check, then one for each command in PROJECT_COMMAND_KEYS order. */
  readonly checks: readonly Check[];
  readonly startedAt: Date;
  readonly finishedAt: Date | undefined;
}
