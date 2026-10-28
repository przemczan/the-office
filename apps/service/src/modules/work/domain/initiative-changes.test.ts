import { describe, expect, it } from "vitest";
import { THE_USER } from "./author.js";
import {
  addTaskToInitiative,
  confirmInitiative,
  dropInitiative,
  finishInitiative,
  initiativeProjectIds,
} from "./initiative-changes.js";
import { InitiativeStateChanged } from "./initiative-events.js";
import { InitiativeRefused } from "./initiative-refused.js";
import { anInitiative, aTask } from "./work.fixtures.js";

const at = new Date("2026-10-28T10:00:00.000Z");

/** The event of a move, but for when it occurred. */
function stateChange(from: string, to: string): object {
  return { constructor: InitiativeStateChanged, initiativeId: "initiative-1", from, to };
}

describe("confirmInitiative", () => {
  it("makes an Initiative being shaped active", () => {
    const change = confirmInitiative(anInitiative());

    expect(change.initiative).toEqual(anInitiative({ state: "active" }));
    expect(change.event).toMatchObject(stateChange("shaping", "active"));
  });

  it("refuses any other", () => {
    for (const state of ["active", "done", "dropped"] as const) {
      expect(() => confirmInitiative(anInitiative({ state }))).toThrow(InitiativeRefused);
    }
  });
});

describe("dropInitiative", () => {
  it("drops one being shaped or active, and changes nothing for a dropped one", () => {
    expect(dropInitiative(anInitiative())?.initiative.state).toBe("dropped");
    expect(dropInitiative(anInitiative({ state: "active" }))?.event).toMatchObject(
      stateChange("active", "dropped"),
    );
    expect(dropInitiative(anInitiative({ state: "dropped" }))).toBeUndefined();
  });

  it("refuses a done one", () => {
    expect(() => dropInitiative(anInitiative({ state: "done" }))).toThrow(
      new InitiativeRefused(["A done Initiative can't be dropped."]),
    );
  });
});

describe("finishInitiative", () => {
  const active = anInitiative({ state: "active" });

  it("makes an active one done once every Task that isn't Dropped is Done", () => {
    const change = finishInitiative(active, [
      aTask({ state: "done" }),
      aTask({ state: "dropped" }),
    ]);

    expect(change?.initiative).toEqual(anInitiative({ state: "done" }));
    expect(change?.event).toMatchObject(stateChange("active", "done"));
  });

  it("waits while a Task isn't Done, or none is", () => {
    expect(finishInitiative(active, [aTask({ state: "done" }), aTask({ state: "ready" })])).toBe(
      undefined,
    );
    expect(finishInitiative(active, [aTask({ state: "dropped" })])).toBeUndefined();
    expect(finishInitiative(active, [])).toBeUndefined();
  });

  it("leaves one being shaped for Confirm, and a dropped or done one as it is", () => {
    for (const state of ["shaping", "dropped", "done"] as const) {
      expect(finishInitiative(anInitiative({ state }), [aTask({ state: "done" })])).toBe(undefined);
    }
  });
});

describe("addTaskToInitiative", () => {
  const setting = { pipelineId: "full", order: "a3", createdBy: THE_USER };
  const given = { title: "Export endpoint", projectId: "api", priority: "normal" } as const;

  it("makes a Task in Backlog that names the Initiative", () => {
    const { task } = addTaskToInitiative(anInitiative(), "task-9", given, setting, at);

    expect(task).toMatchObject({
      id: "task-9",
      projectId: "api",
      state: "backlog",
      initiativeId: "initiative-1",
      originIdeaId: undefined,
    });
  });

  it("refuses a done or dropped Initiative", () => {
    expect(() =>
      addTaskToInitiative(anInitiative({ state: "done" }), "task-9", given, setting, at),
    ).toThrow(new InitiativeRefused(["A done Initiative takes no more Tasks."]));
    expect(() =>
      addTaskToInitiative(anInitiative({ state: "dropped" }), "task-9", given, setting, at),
    ).toThrow(InitiativeRefused);
  });
});

describe("initiativeProjectIds", () => {
  it("spans its Tasks' Projects, each once", () => {
    expect(
      initiativeProjectIds([
        aTask({ projectId: "api" }),
        aTask({ projectId: "web" }),
        aTask({ projectId: "api" }),
      ]),
    ).toEqual(["api", "web"]);
  });
});
