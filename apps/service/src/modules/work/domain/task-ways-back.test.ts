import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UserRef } from "./author.js";
import { taskHistoryLines } from "./record-edits.js";
import type { StateChange } from "./state-change.js";
import { reopenTask, restartTask, startTaskOver } from "./task-changes.js";
import {
  TaskReopened,
  TaskRestored,
  TaskResumed,
  TaskStartedOver,
  TaskStateChanged,
} from "./task-events.js";
import { TaskRefused } from "./task-refused.js";
import {
  CONFLICT_RESOLUTION_NOT_STARTED_OVER,
  LEFT_THE_WORKSTATION,
  PUBLISHING_TASK_NOT_STARTED_OVER,
  waysBackOf,
  type ReopenGrounds,
  type WayBackHolds,
} from "./task-states.js";
import { ANN_LEE, anInitiative, aPlannedTask, aTask } from "./work.fixtures.js";

const ANN: UserRef = { userId: "00000000-0000-4000-8000-0000000005e1", name: "Ann Lee" };
const FREE: WayBackHolds = { initiativePaused: false, alarmHoldsResume: false };
const NO_INITIATIVE: ReopenGrounds = { initiative: undefined, initiativeTasks: [] };
const KEPT_REF = "refs/office/started-over/task-1/1";

const paused = aPlannedTask({ state: "paused", engineStandIns: [] });
const dropped = aPlannedTask({
  state: "dropped",
  endedAt: new Date("2026-11-20T10:00:00.000Z"),
  dropReason: { kind: "wont-fix" },
});

/** The History line of a change's move, as the Task's record words it. */
function historyLineOf(change: { readonly stateChange?: StateChange }): string {
  if (!change.stateChange) throw new Error("The change made no move.");
  return lineOf(change.stateChange);
}

function lineOf(stateChange: StateChange): string {
  return (taskHistoryLines([stateChange], [])[1] ?? "").replace(/^- [^ ]+ /, "");
}

// Each event takes The Office's clock as it is made, so the expected ones are made at the same time.
beforeEach(() => {
  vi.useFakeTimers({ now: new Date("2026-11-24T10:00:00.000Z") });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Restart from…", () => {
  it("goes on In progress as Resume does, its History naming the Stage and the user", () => {
    const change = restartTask(paused, FREE, { stageName: "Build", user: ANN });

    expect(change.task.state).toBe("in-progress");
    expect(change.event).toEqual(new TaskResumed(paused.id));
    expect(historyLineOf(change)).toBe(
      "Paused → In progress, by the user Ann Lee: Restarted from Build",
    );
  });

  it("is refused for a Task not Paused, and while something else holds it, as Resume says", () => {
    const restart = { stageName: "Build", user: ANN };
    expect(() => restartTask(aTask({ state: "in-progress" }), FREE, restart)).toThrow(
      new TaskRefused(["Only a Paused Task can be restarted; this one is in In progress."]),
    );
    expect(() => restartTask({ ...paused, pausedBy: "alarm" }, FREE, restart)).toThrow(
      new TaskRefused(["The fire alarm is on. The Task resumes with the all clear."]),
    );
    expect(() => restartTask({ ...paused, pausedBy: "usage-window" }, FREE, restart)).toThrow(
      new TaskRefused(["Its engine's usage window is used up: the Task resumes at its reset."]),
    );
    expect(() => restartTask(paused, { ...FREE, initiativePaused: true }, restart)).toThrow(
      new TaskRefused(["The Initiative is paused: resume it to go on."]),
    );
    expect(() => restartTask(paused, { ...FREE, alarmHoldsResume: true }, restart)).toThrow(
      new TaskRefused(["The fire alarm is on. Restart it after the all clear."]),
    );
  });
});

describe("Start over", () => {
  it("takes a Paused Task to Ready, confirmed as it was, its History naming the reset", () => {
    const standIn = {
      engineId: "claude",
      standInId: "codex",
      engineName: "Claude",
      standInName: "Codex",
      reason: "Claude's 5-hour window is used up.",
      short: "5-hour window used up",
    };
    const held = { ...paused, engineStandIns: [standIn] };
    const change = startTaskOver(held, FREE, {
      resetBranch: true,
      resetTo: "main",
      keptRef: KEPT_REF,
      user: ANN,
    });

    expect(change.task).toEqual({ ...paused, state: "ready", engineStandIns: [] });
    expect(change.event).toEqual(
      new TaskStartedOver(
        paused.id,
        true,
        "main",
        KEPT_REF,
        ANN,
        new TaskStateChanged(paused.id, "paused", "ready"),
      ),
    );
    expect(historyLineOf(change)).toBe(
      `Paused → Ready, by the user Ann Lee: Started over, its branch reset to main, its old head kept under ${KEPT_REF}`,
    );
  });

  it("says only that it started over when the branch stays", () => {
    const change = startTaskOver(paused, FREE, {
      resetBranch: false,
      resetTo: undefined,
      keptRef: undefined,
      user: ANN,
    });

    expect(historyLineOf(change)).toBe("Paused → Ready, by the user Ann Lee: Started over");
  });

  it("is refused while the alarm, the usage window or the Initiative holds it, not for the alarm alone", () => {
    const over = { resetBranch: false, resetTo: undefined, keptRef: undefined, user: ANN };
    expect(() => startTaskOver(aTask({ state: "dropped" }), FREE, over)).toThrow(
      new TaskRefused(["Only a Paused Task can be started over; this one is in Dropped."]),
    );
    expect(() => startTaskOver({ ...paused, pausedBy: "initiative" }, FREE, over)).toThrow(
      new TaskRefused(["The Initiative is paused: resume it to go on."]),
    );
    expect(() => startTaskOver({ ...paused, pausedBy: "alarm" }, FREE, over)).toThrow(
      new TaskRefused(["The fire alarm is on. The Task resumes with the all clear."]),
    );
    expect(startTaskOver(paused, { ...FREE, alarmHoldsResume: true }, over).task.state).toBe(
      "ready",
    );
  });

  it("is refused for a Publishing and a Conflict resolution Task, whose branch isn't their own", () => {
    const over = { resetBranch: true, resetTo: undefined, keptRef: undefined, user: ANN };
    expect(() => startTaskOver({ ...paused, madeFor: "publishing" }, FREE, over)).toThrow(
      new TaskRefused([PUBLISHING_TASK_NOT_STARTED_OVER]),
    );
    expect(() => startTaskOver({ ...paused, madeFor: "resolve-conflicts" }, FREE, over)).toThrow(
      new TaskRefused([CONFLICT_RESOLUTION_NOT_STARTED_OVER]),
    );
  });
});

describe("Reopen…", () => {
  const at = new Date("2026-11-24T10:00:00.000Z");
  const reopening = { user: ANN, at, startedOver: undefined };

  it("takes a Dropped Task to Backlog, unplanned, its drop reason kept only in its History", () => {
    const change = reopenTask(
      { ...dropped, autoMode: true, markedPlanned: true },
      "backlog",
      NO_INITIATIVE,
      reopening,
    );

    expect(change.task).toEqual({
      ...dropped,
      state: "backlog",
      endedAt: undefined,
      dropReason: undefined,
      hasPlanningThread: false,
    });
    expect(change.event).toEqual(
      new TaskReopened(
        dropped.id,
        "backlog",
        false,
        false,
        undefined,
        undefined,
        ANN,
        new TaskStateChanged(dropped.id, "dropped", "backlog"),
        undefined,
      ),
    );
    expect(historyLineOf(change)).toBe(
      "Dropped → Backlog, by the user Ann Lee: Reopened (dropped as Won't fix)",
    );
  });

  it("takes it to Ready as planned, Restoring an archived one first, and names the Start over", () => {
    const archived = { ...dropped, archivedAt: new Date("2026-11-21T00:00:00.000Z") };
    const change = reopenTask(archived, "ready", NO_INITIATIVE, {
      ...reopening,
      startedOver: { resetBranch: true, resetTo: "main", keptRef: KEPT_REF, user: ANN },
    });

    expect(change.task).toMatchObject({
      state: "ready",
      archivedAt: undefined,
      restoredAt: at,
      restoredBy: { kind: "user", user: ANN },
      hasPlanningThread: true,
      dropReason: undefined,
    });
    expect(change.event.restored).toEqual(new TaskRestored(dropped.id, at));
    expect(change.event.startedOver).toBe(true);
    expect(historyLineOf(change)).toBe(
      `Dropped → Ready, by the user Ann Lee: Reopened (dropped as Won't fix) and started over, its branch reset to main, its old head kept under ${KEPT_REF}`,
    );
  });

  it("reopens a Task of an Initiative still being shaped in Shaping, never Ready", () => {
    const grounds = { initiative: anInitiative({ state: "shaping" }), initiativeTasks: [] };

    expect(reopenTask(dropped, "backlog", grounds, reopening).task.state).toBe("shaping");
    expect(() => reopenTask(dropped, "ready", grounds, reopening)).toThrow(
      new TaskRefused([
        "A Task of an Initiative being shaped is reopened in Shaping: confirm its Initiative first.",
      ]),
    );
  });

  it("refuses Ready until the Plan, Definition of Done and Pipeline are confirmed", () => {
    const unplanned = aTask({ state: "dropped", pipelineId: undefined });

    expect(() => reopenTask(unplanned, "ready", NO_INITIATIVE, reopening)).toThrow(
      new TaskRefused([
        "A Task needs a Plan before it can be Ready.",
        "A Task needs a Definition of Done before it can be Ready.",
        "Choose a Pipeline before the Task can be Ready.",
      ]),
    );
    expect(reopenTask(unplanned, "backlog", NO_INITIATIVE, reopening).task.state).toBe("backlog");
  });

  it("refuses a Task not Dropped, The Office's own Tasks, and one whose Initiative has moved on", () => {
    const refusal =
      (task = dropped, grounds = NO_INITIATIVE) =>
      () =>
        reopenTask(task, "backlog", grounds, reopening);

    expect(refusal(aTask({ state: "done" }))).toThrow(
      new TaskRefused(["Only a Dropped Task can be reopened; this one is in Done."]),
    );
    expect(refusal({ ...dropped, madeFor: "publishing" })).toThrow(
      new TaskRefused([
        "A Publishing Task isn't reopened: The Office adds a new one once the Initiative's other Tasks have ended.",
      ]),
    );
    expect(refusal({ ...dropped, madeFor: "resolve-conflicts" })).toThrow(
      new TaskRefused([
        "A Conflict resolution Task isn't reopened: resolve the conflicts again from the Task whose pull request has them.",
      ]),
    );
    expect(refusal({ ...dropped, madeFor: "onboard" })).toThrow(
      new TaskRefused([
        "A Task The Office made for its own work isn't reopened: start a new one where The Office offers it.",
      ]),
    );
    for (const state of ["done", "dropped"] as const) {
      expect(
        refusal(dropped, { initiative: anInitiative({ state }), initiativeTasks: [] }),
      ).toThrow(
        new TaskRefused([
          `Its Initiative is ${state === "done" ? "Done" : "Dropped"}, so its Tasks stay as they ended.`,
        ]),
      );
    }
    const publishing = aTask({
      id: "publishing-1",
      title: "Usage exports → Admin panel",
      madeFor: "publishing",
      state: "in-progress",
    });
    const active = { initiative: anInitiative({ state: "active" }), initiativeTasks: [publishing] };
    expect(refusal(dropped, active)).toThrow(
      new TaskRefused([
        `Its Initiative's Publishing Task "Usage exports → Admin panel" has started in its Project, so its Tasks there stay as they ended.`,
      ]),
    );
    const notStarted = { ...active, initiativeTasks: [{ ...publishing, state: "ready" as const }] };
    expect(refusal(dropped, notStarted)()).toBeDefined();
  });
});

describe("the ways back offered", () => {
  const grounds = {
    ...NO_INITIATIVE,
    holds: FREE,
    startOverRefusals: [] as string[],
    hadStarted: true,
  };

  it("offers Restart from… and Start over on a Paused Task alone, Reopen… on a Dropped one", () => {
    expect(waysBackOf(paused, grounds)).toEqual({
      restart: { offered: true, why: null },
      startOver: { offered: true, why: null },
      reopen: { offered: false, why: null },
      reopenToReady: { offered: false, why: null },
    });
    expect(waysBackOf(aTask({ ...dropped, pipelineId: undefined }), grounds)).toEqual({
      restart: { offered: false, why: null },
      startOver: { offered: false, why: null },
      reopen: { offered: true, why: null },
      reopenToReady: {
        offered: false,
        why: "Choose a Pipeline before the Task can be Ready.",
      },
    });
  });

  it("says why not once the work has left the workstation, pointing Start over to Restart from…", () => {
    const left = { ...grounds, startOverRefusals: [LEFT_THE_WORKSTATION] };

    expect(waysBackOf(paused, left)).toMatchObject({
      restart: { offered: true, why: null },
      startOver: {
        offered: false,
        why: "Its work has left the workstation: use Restart from… instead.",
      },
    });
    expect(waysBackOf(dropped, left).reopen).toEqual({
      offered: false,
      why: "Its work has left the workstation.",
    });
    expect(waysBackOf(dropped, { ...left, hadStarted: false }).reopen).toEqual({
      offered: true,
      why: null,
    });
  });
});

describe("a way back in the record's History", () => {
  it("names a duplicate's Task and an Other reason's words", () => {
    const by = (droppedAs: NonNullable<(typeof dropped)["dropReason"]>) =>
      lineOf({
        from: "dropped",
        to: "backlog",
        at: new Date("2026-11-24T10:00:00.000Z"),
        by: {
          kind: "user",
          user: ANN,
          wayBack: { kind: "reopen", droppedAs, startedOver: null },
        },
      });

    expect(by({ kind: "duplicate", taskId: "task-2" })).toBe(
      "Dropped → Backlog, by the user Ann Lee: Reopened (dropped as a duplicate of task-2)",
    );
    expect(by({ kind: "other", text: "Not now" })).toBe(
      'Dropped → Backlog, by the user Ann Lee: Reopened (dropped as "Not now")',
    );
    expect(ANN_LEE).toEqual({ kind: "user", user: ANN });
  });
});
