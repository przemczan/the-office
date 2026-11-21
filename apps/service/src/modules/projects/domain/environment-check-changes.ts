import type {
  Check,
  CommandCheck,
  EnvironmentCheck,
  EnvironmentCheckState,
} from "./environment-check.js";
import {
  EnvironmentCheckFinished,
  EnvironmentCheckProgressed,
  EnvironmentCheckStarted,
} from "./environment-check-events.js";
import { isCommandSet, type Project } from "./project.js";
import type { ProjectEnvironment } from "./project-environment.js";

/** An environment check after a change, with the event that announces it. */
export interface EnvironmentCheckChange<Event> {
  readonly check: EnvironmentCheck;
  readonly event: Event;
}

/** Starts a check of every command the Project has; one that isn't set is skipped from the start. */
export function startEnvironmentCheck(
  projectId: string,
  { installCommand, commands }: Pick<Project, "installCommand" | "commands">,
  environment: ProjectEnvironment,
  startedAt: Date,
): EnvironmentCheckChange<EnvironmentCheckStarted> {
  const check: EnvironmentCheck = {
    projectId,
    environment,
    state: "running",
    checks: [
      { step: "worktree", state: "waiting" },
      { step: "install", state: stateAtStart(installCommand), commandLine: installCommand },
      ...commands.map(({ key, name, kind, commandLine }): CommandCheck => ({
        step: "command",
        key,
        name,
        kind,
        commandLine,
        state: stateAtStart(commandLine),
      })),
    ],
    startedAt,
    finishedAt: undefined,
  };
  return { check, event: new EnvironmentCheckStarted(projectId, startedAt) };
}

function stateAtStart(commandLine: string): Check["state"] {
  return isCommandSet(commandLine) ? "waiting" : "skipped";
}

/** Which check this is: its step, or a command's key. */
export function checkIdOf(check: Check): string {
  return check.step === "command" ? `command:${check.key}` : check.step;
}

/** Puts `updated` in the place of the check for the same step, or the same command. */
export function progressEnvironmentCheck(
  environmentCheck: EnvironmentCheck,
  updated: Check,
): EnvironmentCheckChange<EnvironmentCheckProgressed> {
  const check = {
    ...environmentCheck,
    checks: environmentCheck.checks.map((each) =>
      checkIdOf(each) === checkIdOf(updated) ? updated : each,
    ),
  };
  return {
    check,
    event: new EnvironmentCheckProgressed(check.projectId, checkIdOf(updated), updated.state),
  };
}

/**
 * Ends the check: passed when every check passed or was a command not set, stopped when The Office
 * stopped it, failed otherwise. Checks that never ran are skipped.
 */
export function finishEnvironmentCheck(
  environmentCheck: EnvironmentCheck,
  finishedAt: Date,
  stopped: boolean,
): EnvironmentCheckChange<EnvironmentCheckFinished> {
  const checks = environmentCheck.checks.map((each): Check =>
    each.state === "waiting" ? { ...each, state: "skipped" } : each,
  );
  const state: EnvironmentCheckState = stopped
    ? "stopped"
    : checks.every((each) => each.state === "passed" || isNotSet(each))
      ? "passed"
      : "failed";
  const check = { ...environmentCheck, state, checks, finishedAt };
  return { check, event: new EnvironmentCheckFinished(check.projectId, state, finishedAt) };
}

function isNotSet(check: Check): boolean {
  return check.step !== "worktree" && !isCommandSet(check.commandLine);
}
