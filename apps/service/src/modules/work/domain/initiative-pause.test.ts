import { describe, expect, it } from "vitest";
import { dropInitiative, finishInitiative } from "./initiative-changes.js";
import { InitiativePaused, InitiativeResumed } from "./initiative-events.js";
import { isInitiativePaused, pauseInitiative, resumeInitiative } from "./initiative-pause.js";
import { InitiativeRefused } from "./initiative-refused.js";
import { TaskPaused, TaskResumed, TaskStateChanged } from "./task-events.js";
import { ANN_LEE, anInitiative, aTask } from "./work.fixtures.js";

const at = new Date("2026-11-12T12:00:00.000Z");
const active = anInitiative({ state: "active" });
const paused = anInitiative({ state: "active", pausedAt: at });

const running = aTask({ id: "running", state: "in-progress", initiativeId: active.id });
const waiting = aTask({ id: "waiting", state: "waiting-on-you", initiativeId: active.id });
const usersOwn = aTask({ id: "users-own", state: "paused", initiativeId: active.id });
const ready = aTask({ id: "ready", state: "ready", initiativeId: active.id });

describe("pauseInitiative", () => {
  it("marks an active Initiative paused and pauses its running Tasks, leaving the rest", () => {
    const change = pauseInitiative(active, [running, waiting, usersOwn, ready], at, ANN_LEE);

    expect(isInitiativePaused(change.initiative)).toBe(true);
    expect(change.initiative).toMatchObject({ state: "active", pausedAt: at });
    expect(change.event).toBeInstanceOf(InitiativePaused);
    expect(change.event).toMatchObject({ initiativeId: active.id, occurredAt: at });
    expect(change.taskChanges.map(({ task }) => [task.id, task.state, task.pausedBy])).toEqual([
      ["running", "paused", "initiative"],
      ["waiting", "paused", "initiative"],
    ]);
    expect(change.taskChanges.every(({ event }) => event instanceof TaskPaused)).toBe(true);
  });

  it("refuses one that isn't active, and one paused already", () => {
    for (const state of ["shaping", "done", "dropped"] as const) {
      expect(() => pauseInitiative(anInitiative({ state }), [], at, ANN_LEE)).toThrow(
        new InitiativeRefused([`Only an active Initiative can be paused; this one is ${state}.`]),
      );
    }
    expect(() => pauseInitiative(paused, [], at, ANN_LEE)).toThrow(
      new InitiativeRefused(["The Initiative is paused already."]),
    );
  });
});

describe("resumeInitiative", () => {
  const heldByIt = aTask({ id: "held", state: "paused", pausedBy: "initiative" });

  it("clears the mark and resumes exactly the Tasks its Pause held", () => {
    const change = resumeInitiative(
      paused,
      [heldByIt, usersOwn, ready],
      { alarmHoldsResume: false },
      ANN_LEE,
    );

    expect(isInitiativePaused(change.initiative)).toBe(false);
    expect(change.event).toBeInstanceOf(InitiativeResumed);
    expect(change.taskChanges).toHaveLength(1);
    expect(change.taskChanges[0]?.task).toMatchObject({
      id: "held",
      state: "in-progress",
      pausedBy: undefined,
    });
    expect(change.taskChanges[0]?.event).toBeInstanceOf(TaskResumed);
  });

  it("leaves the Tasks to the fire alarm while it is on, for the all clear", () => {
    const change = resumeInitiative(paused, [heldByIt], { alarmHoldsResume: true }, ANN_LEE);

    expect(change.taskChanges[0]?.task).toMatchObject({ state: "paused", pausedBy: "alarm" });
  });

  it("refuses one that isn't paused", () => {
    expect(() => resumeInitiative(active, [], { alarmHoldsResume: false }, ANN_LEE)).toThrow(
      new InitiativeRefused(["Only a paused Initiative can be resumed; this one isn't paused."]),
    );
  });
});

describe("dropInitiative, while paused", () => {
  it("clears the mark and drops the Tasks its Pause held with the user's own", () => {
    const heldByIt = aTask({ id: "held", state: "paused", pausedBy: "initiative" });

    const change = dropInitiative(paused, [heldByIt, usersOwn], at, ANN_LEE);

    expect(change?.initiative).toMatchObject({ state: "dropped", pausedAt: undefined });
    expect(change?.taskChanges.map(({ task }) => [task.id, task.state, task.pausedBy])).toEqual([
      ["held", "dropped", undefined],
      ["users-own", "dropped", undefined],
    ]);
    expect(change?.taskChanges[0]?.event).toBeInstanceOf(TaskStateChanged);
  });
});

describe("finishInitiative, while paused", () => {
  it("clears the mark once its paused Tasks were dropped and the rest are Done", () => {
    const change = finishInitiative(
      paused,
      [aTask({ state: "done" }), aTask({ state: "dropped" })],
      at,
    );

    expect(change?.initiative).toMatchObject({ state: "done", pausedAt: undefined });
  });
});
