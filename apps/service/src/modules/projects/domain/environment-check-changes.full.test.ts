import { describe, expect, it } from "vitest";
import {
  checkIdOf,
  finishEnvironmentCheck,
  progressEnvironmentCheck,
  startEnvironmentCheck,
} from "./environment-check-changes.js";
import {
  EnvironmentCheckFinished,
  EnvironmentCheckProgressed,
  EnvironmentCheckStarted,
} from "./environment-check-events.js";
import type { CheckedCommandRun, EnvironmentCheck } from "./environment-check.js";
import { aProject, startingCommands } from "./project.fixtures.js";

const startedAt = new Date("2026-10-25T10:00:00.000Z");
const finishedAt = new Date("2026-10-25T10:03:00.000Z");
const environment = {
  set: [{ name: "JAVA_HOME", value: "/opt/java-21", secret: false }],
  unset: [],
  prependPath: [],
};

function aRun(
  commandLine: string,
  outcome: CheckedCommandRun["outcome"] = "passed",
): CheckedCommandRun {
  return { commandLine, outcome, exitCode: 0, durationMs: 1200, output: "" };
}

function started(): EnvironmentCheck {
  return startEnvironmentCheck("admin-panel", aProject(), environment, startedAt).check;
}

/** The check with every step passed but `failed`, which failed. */
function allRanBut(failed?: string): EnvironmentCheck {
  return started().checks.reduce(
    (check, each) =>
      progressEnvironmentCheck(check, {
        ...each,
        state: checkIdOf(each) === failed ? "failed" : "passed",
      }).check,
    started(),
  );
}

describe("startEnvironmentCheck", () => {
  it("waits on the worktree, install and each command in order, as they are now", () => {
    const e2e = {
      key: "test-e2e",
      name: "End to end",
      kind: "test",
      commandLine: "npm run e2e",
    } as const;
    const project = aProject({ commands: [...startingCommands(), e2e] });

    const { check, event } = startEnvironmentCheck("admin-panel", project, environment, startedAt);

    expect(check).toEqual({
      projectId: "admin-panel",
      environment,
      state: "running",
      checks: [
        { step: "worktree", state: "waiting" },
        { step: "install", state: "waiting", commandLine: "npm ci" },
        { step: "command", state: "waiting", ...startingCommands()[0] },
        { step: "command", state: "waiting", ...startingCommands()[1] },
        { step: "command", state: "waiting", ...startingCommands()[2] },
        { step: "command", state: "waiting", ...e2e },
      ],
      startedAt,
      finishedAt: undefined,
    });
    expect(event).toEqual(new EnvironmentCheckStarted("admin-panel", startedAt));
  });

  it("skips a command that isn't set from the start", () => {
    const project = aProject({ installCommand: "", commands: startingCommands({ lint: "" }) });

    const { check } = startEnvironmentCheck("admin-panel", project, environment, startedAt);

    expect(check.checks.map((each) => each.state)).toEqual([
      "waiting",
      "skipped",
      "waiting",
      "skipped",
      "waiting",
    ]);
  });
});

describe("progressEnvironmentCheck", () => {
  it("puts one check in place and announces its state", () => {
    const run = aRun("npm run build");

    const build = { step: "command", ...startingCommands()[0]!, state: "passed", run } as const;

    const { check, event } = progressEnvironmentCheck(started(), build);

    expect(check.checks[2]).toEqual(build);
    expect(check.checks.filter((each) => each.state === "waiting")).toHaveLength(4);
    expect(event).toBeInstanceOf(EnvironmentCheckProgressed);
    expect(event).toMatchObject({
      projectId: "admin-panel",
      check: "command:build",
      state: "passed",
    });
  });
});

describe("finishEnvironmentCheck", () => {
  it("passes when every check passed", () => {
    const { check, event } = finishEnvironmentCheck(allRanBut(), finishedAt, false);

    expect(check).toMatchObject({ state: "passed", finishedAt });
    expect(event).toEqual(new EnvironmentCheckFinished("admin-panel", "passed", finishedAt));
  });

  it("fails when one check failed", () => {
    const lintFailed = allRanBut("command:lint");

    expect(finishEnvironmentCheck(lintFailed, finishedAt, false).check.state).toBe("failed");
  });

  it("skips the checks that never ran", () => {
    const installFailed = progressEnvironmentCheck(
      progressEnvironmentCheck(started(), { step: "worktree", state: "passed" }).check,
      { step: "install", state: "failed", commandLine: "npm ci", run: aRun("npm ci", "failed") },
    ).check;

    const { check } = finishEnvironmentCheck(installFailed, finishedAt, false);

    expect(check.state).toBe("failed");
    expect(check.checks.map((each) => each.state)).toEqual([
      "passed",
      "failed",
      "skipped",
      "skipped",
      "skipped",
    ]);
  });

  it("passes when every check passed but the commands that aren't set", () => {
    const project = aProject({ installCommand: "", commands: startingCommands({ lint: "" }) });
    const notSet = startEnvironmentCheck("admin-panel", project, environment, startedAt).check;
    const ran = notSet.checks
      .filter((each) => each.state === "waiting")
      .reduce(
        (check, each) => progressEnvironmentCheck(check, { ...each, state: "passed" }).check,
        notSet,
      );

    expect(finishEnvironmentCheck(ran, finishedAt, false).check.state).toBe("passed");
  });

  it("is stopped when The Office stopped it, whatever its checks", () => {
    expect(finishEnvironmentCheck(allRanBut(), finishedAt, true).check.state).toBe("stopped");
  });
});
