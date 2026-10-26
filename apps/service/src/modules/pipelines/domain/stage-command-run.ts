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
}

/**
 * Why The Office ran a command for a Stage: the dependencies' install before it, the Script
 * Stage's command, or a failing test command's one re-run.
 */
export type StageCommandPurpose = "install" | "command" | "re-run";

/** A command a Stage run ran, as the run records it. */
export interface StageCommandRun extends CommandRun {
  readonly purpose: StageCommandPurpose;
}

/** Whether the install before a Stage ran, and how it went. */
export type Installation =
  { readonly kind: "up-to-date" } | { readonly kind: "ran"; readonly run: CommandRun };

/** The install's run when it ran, as a Stage run records it. */
export function installRuns(installation: Installation): StageCommandRun[] {
  return installation.kind === "ran" ? [{ ...installation.run, purpose: "install" }] : [];
}

/** The install's run when it ran and didn't pass. */
export function failedInstall(installation: Installation): CommandRun | undefined {
  return installation.kind === "ran" && installation.run.outcome !== "passed"
    ? installation.run
    : undefined;
}

/** A Script Stage's command's runs, in order: the first, then a re-run when there was one. */
export function commandRunsOf(runs: readonly CommandRun[]): StageCommandRun[] {
  return runs.map((run, index) => ({ ...run, purpose: index === 0 ? "command" : "re-run" }));
}

/** How a command ended, in a sentence's words. */
export function howItEnded(run: CommandRun): string {
  switch (run.outcome) {
    case "passed":
      return "passed";
    case "failed":
      return run.exitCode === undefined ? "failed" : `failed with exit code ${run.exitCode}`;
    case "could-not-run":
      return "couldn't be run: the shell couldn't start it, as when its program isn't installed";
    case "timed-out":
      return `ran out of time after ${Math.round(run.durationMs / 60_000)} minutes and was ended`;
    case "stopped":
      return "was stopped by The Office";
  }
}
