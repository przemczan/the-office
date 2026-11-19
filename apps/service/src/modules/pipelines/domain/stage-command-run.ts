/** How a Project command ended, as Projects tells it. */
export type CommandOutcome = "passed" | "failed" | "could-not-run" | "timed-out" | "stopped";

/** A Project command The Office ran in a Task's worktree. */
export interface CommandRun {
  readonly commandLine: string;
  readonly outcome: CommandOutcome;
  /** Undefined when it never exited by itself. */
  readonly exitCode: number | undefined;
  readonly durationMs: number;
  /** What it printed, cut to what tells why it failed and the end. */
  readonly output: string;
  /** What it printed for the user to read: its last 64 KB, with a line saying how much was cut. */
  readonly wholeOutput: string;
}

/** The files a test run wrote into the worktree, moved out of it so no commit holds them. */
export interface MovedFiles {
  /** Where they are now, under the Office data directory, each at its path in the worktree. */
  readonly folder: string;
  /** Relative to the worktree, with "/" between folders. */
  readonly paths: readonly string[];
}

/** A run of a Script Stage's command. */
export interface ScriptCommandRun extends CommandRun {
  /** Undefined when it wrote no file, and after a command that isn't the tests. */
  readonly movedFiles: MovedFiles | undefined;
}

/**
 * Why The Office ran a command for a Stage: the dependencies' install before it, the Script
 * Stage's command, a failing test command's one re-run, a Publish's before or after publishing
 * line, or the Project command a condition of one of the Stage's routes out names.
 */
export type StageCommandPurpose =
  "install" | "command" | "re-run" | "before-publishing" | "after-publishing" | "condition";

/**
 * The Project-command test a condition command was run for (spec §2.3, "The Project-command
 * condition"): the test's place among the routes out of the run's Stage, which the walk replays its
 * result by.
 */
export interface ConditionCommandTest {
  readonly key: string;
  /** The key of the Stage the route leads to; null for End. */
  readonly to: string | null;
  /** The route's place among the Stage's routes out, from 0. */
  readonly routeIndex: number;
  /** The test's place in the route's condition: its index in each nested group in turn, from 0. */
  readonly testPath: readonly number[];
}

/** A command a Stage run ran, as the run records it; its whole output is read apart from it. */
export interface StageCommandRun extends Omit<CommandRun, "wholeOutput"> {
  readonly purpose: StageCommandPurpose;
  /** The files a test run wrote, moved out of the worktree; undefined for none. */
  readonly movedFiles?: MovedFiles;
  /**
   * Set on a condition command's run and on the install run before it: the test it was run for,
   * on the run of the Stage the route leaves.
   */
  readonly condition?: ConditionCommandTest;
}

/** A command a Stage run ran, as it is saved. */
export interface StageCommandRunWithOutput extends StageCommandRun {
  readonly wholeOutput: string;
}

/** Whether the install before a Stage ran, and how it went. */
export type Installation =
  { readonly kind: "up-to-date" } | { readonly kind: "ran"; readonly run: CommandRun };

/**
 * The install's run when it ran, as a Stage run records it; `condition` marks one run before a
 * condition command.
 */
export function installRuns(
  installation: Installation,
  condition?: ConditionCommandTest,
): StageCommandRunWithOutput[] {
  if (installation.kind !== "ran") return [];
  return [{ ...installation.run, purpose: "install", ...(condition && { condition }) }];
}

/** The install's run when it ran and didn't pass. */
export function failedInstall(installation: Installation): CommandRun | undefined {
  return installation.kind === "ran" && installation.run.outcome !== "passed"
    ? installation.run
    : undefined;
}

/** A Script Stage's command's runs, in order: the first, then a re-run when there was one. */
export function commandRunsOf(runs: readonly ScriptCommandRun[]): StageCommandRunWithOutput[] {
  return runs.map(({ movedFiles, ...run }, index) => ({
    ...run,
    purpose: index === 0 ? "command" : "re-run",
    ...(movedFiles && { movedFiles }),
  }));
}

/** A condition command's runs, each marked with the test it was run for. */
export function conditionRunsOf(
  runs: readonly ScriptCommandRun[],
  condition: ConditionCommandTest,
): StageCommandRunWithOutput[] {
  return runs.map(({ movedFiles, ...run }) => ({
    ...run,
    purpose: "condition",
    condition,
    ...(movedFiles && { movedFiles }),
  }));
}

/** How a command ended, in a sentence's words. */
export function howItEnded(run: Pick<CommandRun, "outcome" | "exitCode" | "durationMs">): string {
  switch (run.outcome) {
    case "passed":
      return "passed";
    case "failed":
      return run.exitCode === undefined ? "failed" : `failed with exit code ${run.exitCode}`;
    case "could-not-run":
      return "couldn't be run, as when its program isn't installed or its run environment can't start";
    case "timed-out":
      return `ran out of time after ${Math.round(run.durationMs / 60_000)} minutes and was ended`;
    case "stopped":
      return "was stopped by The Office";
  }
}
