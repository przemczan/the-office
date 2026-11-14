import { describe, expect, it } from "vitest";
import { startWaitsForUsage, type UsageAtStart } from "./cap-waits.js";
import { resumeInitiative } from "./initiative-pause.js";
import {
  changeTaskState,
  pauseTaskForAlarm,
  pauseTaskForInitiative,
  pauseTaskForUsageWindow,
  resumeTask,
  resumeTaskAtReset,
  resumeTaskForInitiative,
  stopTask,
} from "./task-changes.js";
import { TaskPaused, TaskResumed } from "./task-events.js";
import { ANN_LEE, anInitiative, aTask } from "./work.fixtures.js";

// A pause by the usage window (spec §2.1), with the alarm and an Initiative's Pause (spec §2.8).

const NOW = new Date(2026, 10, 13, 12, 0);
const RESET = new Date(2026, 10, 13, 14, 0);
const LATER_RESET = new Date(2026, 10, 20, 9, 0);
const REFUSAL = {
  engineId: "claude-code",
  engineName: "Claude Code",
  window: "five-hour",
  resetsAt: RESET,
};

const pausedByTheWindow = aTask({ state: "paused", pausedBy: "usage-window", resumesAt: RESET });

describe("pauseTaskForUsageWindow", () => {
  it("pauses a running Task by the usage window until the reset, by the usage window", () => {
    const change = pauseTaskForUsageWindow(aTask({ state: "in-progress" }), REFUSAL);

    expect(change?.task).toMatchObject({
      state: "paused",
      pausedBy: "usage-window",
      resumesAt: RESET,
    });
    expect(change?.event).toBeInstanceOf(TaskPaused);
    expect(change?.event).toMatchObject({
      from: "in-progress",
      by: "usage-window",
      usageWindow: REFUSAL,
    });
    expect(change?.stateChange?.by).toEqual({ kind: "usage-window" });
    expect(
      pauseTaskForUsageWindow(aTask({ state: "waiting-on-you" }), REFUSAL)?.task.pausedBy,
    ).toBe("usage-window");
  });

  it("moves the resume of a Task it paused already on to the new reset", () => {
    const change = pauseTaskForUsageWindow(pausedByTheWindow, {
      ...REFUSAL,
      window: "seven-day",
      resetsAt: LATER_RESET,
    });

    expect(change?.task.resumesAt).toEqual(LATER_RESET);
    expect(change?.event).toMatchObject({ from: "paused", by: "usage-window" });
    expect(change?.stateChange).toBeUndefined();
  });

  it("leaves a Task the user, the alarm or its Initiative holds, and one not running, as it is", () => {
    for (const task of [
      aTask({ state: "paused" }),
      aTask({ state: "paused", pausedBy: "alarm" }),
      aTask({ state: "paused", pausedBy: "initiative" }),
      aTask({ state: "ready" }),
    ]) {
      expect(pauseTaskForUsageWindow(task, REFUSAL)).toBeUndefined();
    }
  });
});

describe("resumeTaskAtReset", () => {
  it("resumes a Task the usage window paused at its reset, by the usage window", () => {
    const change = resumeTaskAtReset(pausedByTheWindow, { fireAlarmOn: false, now: RESET });

    expect(change?.task).toMatchObject({
      state: "in-progress",
      pausedBy: undefined,
      resumesAt: undefined,
    });
    expect(change?.event).toBeInstanceOf(TaskResumed);
    expect(change?.stateChange?.by).toEqual({ kind: "usage-window" });
  });

  it("waits for the reset, and leaves the Task to the alarm while it is on", () => {
    expect(resumeTaskAtReset(pausedByTheWindow, { fireAlarmOn: false, now: NOW })).toBeUndefined();

    const held = resumeTaskAtReset(pausedByTheWindow, { fireAlarmOn: true, now: RESET });

    expect(held?.task).toMatchObject({ state: "paused", pausedBy: "alarm", resumesAt: undefined });
    expect(held?.event).toMatchObject({ from: "paused", by: "alarm" });
  });

  it("leaves a Task anyone else holds by now", () => {
    for (const task of [
      aTask({ state: "paused", resumesAt: undefined }),
      aTask({ state: "paused", pausedBy: "initiative", resumesAt: RESET }),
      aTask({ state: "in-progress" }),
    ]) {
      expect(resumeTaskAtReset(task, { fireAlarmOn: false, now: RESET })).toBeUndefined();
    }
  });
});

describe("the user's actions on a Task the usage window paused", () => {
  it("Resume, Stop and Drop work as usual, each clearing the resume time", () => {
    const resumed = resumeTask(
      pausedByTheWindow,
      { fireAlarmOn: false, initiativePaused: false },
      ANN_LEE,
    );
    const keptByTheAlarm = resumeTask(
      pausedByTheWindow,
      {
        fireAlarmOn: true,
        initiativePaused: false,
      },
      ANN_LEE,
    );

    expect(resumed.task).toMatchObject({ state: "in-progress", resumesAt: undefined });
    expect(keptByTheAlarm.task).toMatchObject({ pausedBy: "alarm", resumesAt: undefined });
    expect(stopTask(pausedByTheWindow, ANN_LEE).task).toMatchObject({
      state: "paused",
      pausedBy: undefined,
      resumesAt: undefined,
    });
    expect(changeTaskState(pausedByTheWindow, "dropped", ANN_LEE)?.task).toMatchObject({
      state: "dropped",
      pausedBy: undefined,
      resumesAt: undefined,
    });
  });

  it("the fire alarm sounding leaves it paused by the usage window", () => {
    expect(pauseTaskForAlarm(pausedByTheWindow)).toBeUndefined();
  });
});

describe("an Initiative's Pause and the usage window", () => {
  it("Pause the Initiative takes it over, keeping the reset", () => {
    const change = pauseTaskForInitiative(pausedByTheWindow, ANN_LEE);

    expect(change?.task).toMatchObject({ pausedBy: "initiative", resumesAt: RESET });
    expect(change?.event).toMatchObject({ from: "paused", by: "initiative" });
  });

  it("Resume the Initiative before the reset hands it back to the usage window, after it resumes it", () => {
    const held = aTask({ state: "paused", pausedBy: "initiative", resumesAt: RESET });

    const before = resumeTaskForInitiative(held, { fireAlarmOn: false, now: NOW }, ANN_LEE);
    const after = resumeTaskForInitiative(held, { fireAlarmOn: false, now: RESET }, ANN_LEE);

    expect(before?.task).toMatchObject({ pausedBy: "usage-window", resumesAt: RESET });
    expect(before?.event).toMatchObject({ from: "paused", by: "usage-window" });
    expect(after?.task).toMatchObject({ state: "in-progress", resumesAt: undefined });
    expect(after?.event).toBeInstanceOf(TaskResumed);
  });

  it("Resume the Initiative reads its clock for each Task", () => {
    const initiative = anInitiative({ state: "active", pausedAt: NOW });
    const held = aTask({ state: "paused", pausedBy: "initiative", resumesAt: RESET });

    const change = resumeInitiative(initiative, [held], { fireAlarmOn: false, now: NOW }, ANN_LEE);

    expect(change.taskChanges.map(({ task }) => task.pausedBy)).toEqual(["usage-window"]);
  });
});

function usage(fields: Partial<UsageAtStart>): UsageAtStart {
  return {
    now: NOW,
    measures: [],
    estimate: [],
    windows: [],
    daily: [],
    engineNames: new Map([["claude-code", "Claude Code"]]),
    usedUp: [],
    ...fields,
  };
}

describe("startWaitsForUsage, while an engine's usage window is used up", () => {
  it("holds the Start, whatever the caps say, naming the engine, the window and the reset", () => {
    const waits = startWaitsForUsage(
      usage({ usedUp: [{ engineId: "claude-code", windowWords: "5-hour window", until: RESET }] }),
    );

    expect(waits).toEqual({
      waits: [
        {
          reason: "Claude Code's 5-hour window is used up until 14:00.",
          short: "5-hour window used up · until 14:00",
        },
      ],
      resetsAt: RESET,
    });
  });

  it("names the day of a reset on another day", () => {
    const { waits } = startWaitsForUsage(
      usage({
        usedUp: [{ engineId: "claude-code", windowWords: "7-day window", until: LATER_RESET }],
      }),
    );

    expect(waits[0]?.short).toBe("7-day window used up · until Fri 20 Nov 09:00");
  });

  it("holds nothing once the reset has passed, nor for an engine not used up", () => {
    expect(
      startWaitsForUsage(
        usage({
          now: RESET,
          usedUp: [{ engineId: "claude-code", windowWords: "5-hour window", until: RESET }],
        }),
      ),
    ).toEqual({ waits: [], resetsAt: undefined });
    expect(startWaitsForUsage(usage({}))).toEqual({ waits: [], resetsAt: undefined });
  });
});
