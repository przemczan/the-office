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
import { PROJECT_COMMAND_KEYS, type ProjectCommands } from "./project.js";
import type { ProjectEnvironment } from "./project-environment.js";

/** An environment check after a change, with the event that announces it. */
export interface EnvironmentCheckChange<Event> {
  readonly check: EnvironmentCheck;
  readonly event: Event;
}

export function startEnvironmentCheck(
  projectId: string,
  commands: ProjectCommands,
  environment: ProjectEnvironment,
  startedAt: Date,
): EnvironmentCheckChange<EnvironmentCheckStarted> {
  const check: EnvironmentCheck = {
    projectId,
    environment,
    state: "running",
    checks: [
      { step: "worktree", state: "waiting" },
      ...PROJECT_COMMAND_KEYS.map((key): CommandCheck => ({
        step: key,
        state: "waiting",
        commandLine: commands[key],
      })),
    ],
    startedAt,
    finishedAt: undefined,
  };
  return { check, event: new EnvironmentCheckStarted(projectId, startedAt) };
}

/** Puts `updated` in the place of the check for the same step. */
export function progressEnvironmentCheck(
  environmentCheck: EnvironmentCheck,
  updated: Check,
): EnvironmentCheckChange<EnvironmentCheckProgressed> {
  const check = {
    ...environmentCheck,
    checks: environmentCheck.checks.map((each) => (each.step === updated.step ? updated : each)),
  };
  return {
    check,
    event: new EnvironmentCheckProgressed(check.projectId, updated.step, updated.state),
  };
}

/**
 * Ends the check: passed when every check passed, stopped when The Office stopped it, failed
 * otherwise. Checks that never ran are skipped.
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
    : checks.every((each) => each.state === "passed")
      ? "passed"
      : "failed";
  const check = { ...environmentCheck, state, checks, finishedAt };
  return { check, event: new EnvironmentCheckFinished(check.projectId, state, finishedAt) };
}
