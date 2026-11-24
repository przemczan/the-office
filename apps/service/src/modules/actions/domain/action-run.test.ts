import { describe, expect, it } from "vitest";
import {
  failedRun,
  KEPT_RUNS,
  runsPastTheKept,
  sinceWords,
  startedRun,
  stoppedRun,
  testTargetOutcomeOf,
  workflowFollowed,
  workflowOutcomeOf,
  type ActionRun,
} from "./action-run.js";
import { actionsAtOnceFull, runningAlready } from "./action-run-words.js";

const AT = new Date("2003-04-05T10:00:00Z");

function aRun(extra: Partial<Parameters<typeof startedRun>[0]> = {}): ActionRun {
  return startedRun({
    id: "run-1",
    projectId: "shop",
    actionKey: "build-web",
    actionName: "Build web",
    kind: "project-command",
    ranFrom: { kind: "branch" },
    branch: "main",
    startCommit: "c0ffee0000000000000000000000000000000001",
    startedBy: { userId: "user-ann", name: "Ann Lee" },
    at: AT,
    ...extra,
  });
}

describe("an Action run's states", () => {
  it("maps a Test target run's instance states to outcomes", () => {
    expect(testTargetOutcomeOf("building", false)).toBeUndefined();
    expect(testTargetOutcomeOf("running", false)).toBeUndefined();
    expect(testTargetOutcomeOf("built", false)).toBe("succeeded");
    expect(testTargetOutcomeOf("stopped", false)).toBe("stopped");
    expect(testTargetOutcomeOf("failed", true)).toBe("stopped");
    expect(testTargetOutcomeOf("failed", false)).toBe("failed");
  });

  it("maps a Workflow run's CI run statuses to outcomes", () => {
    for (const state of ["starting", "queued", "waiting", "running"] as const) {
      expect(workflowOutcomeOf(state)).toBeUndefined();
    }
    expect(workflowOutcomeOf("succeeded")).toBe("succeeded");
    expect(workflowOutcomeOf("cancelled")).toBe("stopped");
    expect(workflowOutcomeOf("skipped")).toBe("stopped");
    expect(workflowOutcomeOf("failed")).toBe("failed");
    expect(workflowOutcomeOf("unknown")).toBe("failed");
  });

  it("starts each kind in its first state, a Workflow run with no commit yet", () => {
    expect(aRun().status).toEqual({ kind: "project-command", state: "running" });
    expect(aRun({ kind: "test-target" }).status).toEqual({
      kind: "test-target",
      state: "building",
    });
    const workflow = aRun({ kind: "workflow", workflowFile: "release.yml" });
    expect(workflow.status).toEqual({ kind: "workflow", state: "starting" });
    expect(workflow.commit).toBeUndefined();
  });

  it("ends once: a stop after a failure changes nothing", () => {
    const failed = failedRun(aRun(), "The command ended with exit code 1.", AT, { exitCode: 1 });
    expect(failed).toMatchObject({ outcome: "failed", exitCode: 1, status: { state: "failed" } });
    expect(stoppedRun(failed as ActionRun, { kind: "fire-alarm" }, AT)).toBeUndefined();
    expect(stoppedRun(aRun(), { kind: "fire-alarm" }, AT)).toMatchObject({
      outcome: "stopped",
      endedBecause: "Stopped by the fire alarm.",
      stoppedBy: "fire-alarm",
    });
  });

  it("notes a Workflow run whose CI run ran another commit", () => {
    const run = aRun({ kind: "workflow" });
    const ciRun = { id: 1, number: 2, workflowName: "Release", url: "https://example.com/1" };
    expect(
      workflowFollowed(run, { ...ciRun, commit: run.startCommit, status: "running" }, AT)?.note,
    ).toBeUndefined();
    expect(
      workflowFollowed(run, { ...ciRun, commit: "beef000000", status: "running" }, AT)?.note,
    ).toBe("It ran beef000: main moved as it started.");
  });
});

describe("the runs kept and the refusals' words", () => {
  it("keeps the newest 20, never removing a running one", () => {
    const runs = Array.from({ length: KEPT_RUNS + 2 }, (_, index) => {
      const run = aRun({ id: `run-${index}` });
      return index === KEPT_RUNS ? run : (failedRun(run, "Old.", AT) as ActionRun);
    });
    expect(runsPastTheKept(runs).map(({ id }) => id)).toEqual([`run-${KEPT_RUNS + 1}`]);
  });

  it("names the runs holding Actions at once and who started a run running already", () => {
    const one = aRun();
    const other = aRun({ actionName: "Lint", branch: "fix-login" });
    expect(actionsAtOnceFull([one, other])).toBe(
      "2 Actions are running: Build web on main, Lint on fix-login. Stop one to start another.",
    );
    expect(runningAlready(one, new Date(AT.getTime() + 5 * 60_000))).toBe(
      "Build web is running already, started by Ann Lee 5 minutes ago.",
    );
    expect(sinceWords(AT, new Date(AT.getTime() + 25 * 3_600_000))).toBe("1 day ago");
  });
});
