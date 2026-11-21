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
  resumeTaskFreedByUsageWindow,
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

const pausedByTheWindow = aTask({
  state: "paused",
  pausedBy: "usage-window",
  resumesAt: RESET,
  usageWindowEngineId: "claude-code",
  usageWindowPausedAt: NOW,
});
const CLEARED = {
  resumesAt: undefined,
  usageWindowEngineId: undefined,
  usageWindowPausedAt: undefined,
};

describe("pauseTaskForUsageWindow", () => {
  it("pauses a running Task by the usage window until the reset, by the usage window", () => {
    const change = pauseTaskForUsageWindow(aTask({ state: "in-progress" }), REFUSAL, NOW);

    expect(change?.task).toMatchObject({
      state: "paused",
      pausedBy: "usage-window",
      resumesAt: RESET,
      usageWindowEngineId: "claude-code",
      usageWindowPausedAt: NOW,
    });
    expect(change?.event).toBeInstanceOf(TaskPaused);
    expect(change?.event).toMatchObject({
      from: "in-progress",
      by: "usage-window",
      usageWindow: REFUSAL,
    });
    expect(change?.stateChange?.by).toEqual({ kind: "usage-window" });
    expect(
      pauseTaskForUsageWindow(aTask({ state: "waiting-on-you" }), REFUSAL, NOW)?.task.pausedBy,
    ).toBe("usage-window");
  });

  it("moves the resume of a Task it paused already on to the new reset", () => {
    const later = new Date(NOW.getTime() + 60_000);
    const change = pauseTaskForUsageWindow(
      pausedByTheWindow,
      { ...REFUSAL, window: "seven-day", resetsAt: LATER_RESET },
      later,
    );

    expect(change?.task).toMatchObject({
      resumesAt: LATER_RESET,
      usageWindowEngineId: "claude-code",
      usageWindowPausedAt: later,
    });
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
      expect(pauseTaskForUsageWindow(task, REFUSAL, NOW)).toBeUndefined();
    }
  });
});

describe("resumeTaskAtReset", () => {
  it("resumes a Task the usage window paused at its reset, by the usage window", () => {
    const change = resumeTaskAtReset(pausedByTheWindow, { alarmHoldsResume: false, now: RESET });

    expect(change?.task).toMatchObject({ state: "in-progress", pausedBy: undefined, ...CLEARED });
    expect(change?.event).toBeInstanceOf(TaskResumed);
    expect(change?.stateChange?.by).toEqual({ kind: "usage-window" });
  });

  it("waits for the reset, and leaves the Task to the alarm while it is on", () => {
    expect(
      resumeTaskAtReset(pausedByTheWindow, { alarmHoldsResume: false, now: NOW }),
    ).toBeUndefined();

    const held = resumeTaskAtReset(pausedByTheWindow, { alarmHoldsResume: true, now: RESET });

    expect(held?.task).toMatchObject({ state: "paused", pausedBy: "alarm", ...CLEARED });
    expect(held?.event).toMatchObject({ from: "paused", by: "alarm" });
  });

  it("does nothing for a Task a free reading resumed before the reset", () => {
    const early = resumeTaskFreedByUsageWindow(pausedByTheWindow, {
      alarmHoldsResume: false,
      engineId: "claude-code",
      readAt: new Date(NOW.getTime() + 60_000),
    });

    expect(early?.task.state).toBe("in-progress");
    expect(
      resumeTaskAtReset(early?.task ?? pausedByTheWindow, { alarmHoldsResume: false, now: RESET }),
    ).toBeUndefined();
  });

  it("leaves a Task anyone else holds by now", () => {
    for (const task of [
      aTask({ state: "paused", resumesAt: undefined }),
      aTask({ state: "paused", pausedBy: "initiative", resumesAt: RESET }),
      aTask({ state: "in-progress" }),
    ]) {
      expect(resumeTaskAtReset(task, { alarmHoldsResume: false, now: RESET })).toBeUndefined();
    }
  });
});

describe("resumeTaskFreedByUsageWindow", () => {
  const AFTER = new Date(NOW.getTime() + 60_000);

  it("resumes a Task that engine's usage window paused before the free reading was taken", () => {
    const change = resumeTaskFreedByUsageWindow(pausedByTheWindow, {
      alarmHoldsResume: false,
      engineId: "claude-code",
      readAt: AFTER,
    });

    expect(change?.task).toMatchObject({ state: "in-progress", pausedBy: undefined, ...CLEARED });
    expect(change?.event).toBeInstanceOf(TaskResumed);
    expect(change?.stateChange?.by).toEqual({ kind: "usage-window" });
  });

  it("leaves the Task to the alarm while it is on", () => {
    const held = resumeTaskFreedByUsageWindow(pausedByTheWindow, {
      alarmHoldsResume: true,
      engineId: "claude-code",
      readAt: AFTER,
    });

    expect(held?.task).toMatchObject({ state: "paused", pausedBy: "alarm", ...CLEARED });
  });

  it("leaves one paused by another engine, at or after the reading, or with no engine kept", () => {
    const free = { alarmHoldsResume: false, engineId: "claude-code", readAt: AFTER };

    expect(
      resumeTaskFreedByUsageWindow(pausedByTheWindow, { ...free, engineId: "codex" }),
    ).toBeUndefined();
    expect(
      resumeTaskFreedByUsageWindow(pausedByTheWindow, { ...free, readAt: NOW }),
    ).toBeUndefined();
    expect(
      resumeTaskFreedByUsageWindow(
        aTask({ state: "paused", pausedBy: "usage-window", resumesAt: RESET }),
        free,
      ),
    ).toBeUndefined();
    expect(
      resumeTaskFreedByUsageWindow({ ...pausedByTheWindow, pausedBy: "initiative" }, free),
    ).toBeUndefined();
  });
});

describe("the user's actions on a Task the usage window paused", () => {
  it("Resume, Stop and Drop work as usual, each clearing the resume time", () => {
    const resumed = resumeTask(
      pausedByTheWindow,
      { alarmHoldsResume: false, initiativePaused: false },
      ANN_LEE,
    );
    const keptByTheAlarm = resumeTask(
      pausedByTheWindow,
      {
        alarmHoldsResume: true,
        initiativePaused: false,
      },
      ANN_LEE,
    );

    expect(resumed.task).toMatchObject({ state: "in-progress", ...CLEARED });
    expect(keptByTheAlarm.task).toMatchObject({ pausedBy: "alarm", ...CLEARED });
    expect(stopTask(pausedByTheWindow, ANN_LEE).task).toMatchObject({
      state: "paused",
      pausedBy: undefined,
      ...CLEARED,
    });
    expect(changeTaskState(pausedByTheWindow, "dropped", ANN_LEE)?.task).toMatchObject({
      state: "dropped",
      pausedBy: undefined,
      ...CLEARED,
    });
  });

  it("the fire alarm sounding leaves it paused by the usage window", () => {
    expect(pauseTaskForAlarm(pausedByTheWindow)).toBeUndefined();
  });
});

describe("an Initiative's Pause and the usage window", () => {
  it("Pause the Initiative takes it over, keeping the reset", () => {
    const change = pauseTaskForInitiative(pausedByTheWindow, ANN_LEE);

    expect(change?.task).toMatchObject({
      pausedBy: "initiative",
      resumesAt: RESET,
      usageWindowEngineId: "claude-code",
      usageWindowPausedAt: NOW,
    });
    expect(change?.event).toMatchObject({ from: "paused", by: "initiative" });
  });

  it("Resume the Initiative before the reset hands it back to the usage window, after it resumes it", () => {
    const held = aTask({ state: "paused", pausedBy: "initiative", resumesAt: RESET });

    const before = resumeTaskForInitiative(held, { alarmHoldsResume: false, now: NOW }, ANN_LEE);
    const after = resumeTaskForInitiative(held, { alarmHoldsResume: false, now: RESET }, ANN_LEE);

    expect(before?.task).toMatchObject({ pausedBy: "usage-window", resumesAt: RESET });
    expect(before?.event).toMatchObject({ from: "paused", by: "usage-window" });
    expect(after?.task).toMatchObject({ state: "in-progress", resumesAt: undefined });
    expect(after?.event).toBeInstanceOf(TaskResumed);
  });

  it("Resume the Initiative reads its clock for each Task", () => {
    const initiative = anInitiative({ state: "active", pausedAt: NOW });
    const held = aTask({ state: "paused", pausedBy: "initiative", resumesAt: RESET });

    const change = resumeInitiative(
      initiative,
      [held],
      { alarmHoldsResume: false, now: NOW },
      ANN_LEE,
    );

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
