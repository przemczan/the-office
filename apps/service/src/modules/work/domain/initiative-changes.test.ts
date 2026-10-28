import { describe, expect, it } from "vitest";
import { THE_USER } from "./author.js";
import {
  addCtoTask,
  addDependencyOfItsTask,
  addTaskToInitiative,
  confirmInitiative,
  dropInitiative,
  finishInitiative,
  initiativeProjectIds,
  removeDependencyOfItsTask,
  writeOutcome,
} from "./initiative-changes.js";
import { InitiativeOutcomeWritten, InitiativeStateChanged } from "./initiative-events.js";
import { InitiativeNotShaping } from "./initiative-not-shaping.js";
import { InitiativeRefused } from "./initiative-refused.js";
import { TaskRefused } from "./task-refused.js";
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

describe("writeOutcome", () => {
  it("writes the outcome of an Initiative being shaped, trimmed", () => {
    const change = writeOutcome(
      anInitiative(),
      "  Writes made offline reach the server.\n",
      "straight",
    );

    expect(change?.initiative).toEqual(
      anInitiative({ outcome: "Writes made offline reach the server." }),
    );
    expect(change?.event).toMatchObject({
      constructor: InitiativeOutcomeWritten,
      initiativeId: "initiative-1",
      outcome: "Writes made offline reach the server.",
    });
  });

  it("changes nothing when it says so already, whatever the state", () => {
    const done = anInitiative({ state: "done", outcome: "Sync works." });

    expect(writeOutcome(done, "Sync works.", "straight")).toBeUndefined();
  });

  it("refuses an empty one before judging the state", () => {
    expect(() => writeOutcome(anInitiative({ state: "active" }), "  ", "straight")).toThrow(
      new InitiativeRefused(["Write what must be true once the Initiative is done."]),
    );
  });

  it("writes straight onto it only while it is being shaped", () => {
    for (const state of ["active", "done", "dropped"] as const) {
      expect(() => writeOutcome(anInitiative({ state }), "Sync works.", "straight")).toThrow(
        new InitiativeNotShaping(state, "its outcome is written"),
      );
    }
  });

  it("writes it by Proposal while it is shaping or active, never once done or dropped", () => {
    for (const state of ["shaping", "active"] as const) {
      const change = writeOutcome(anInitiative({ state }), "Sync works.", "by-proposal");
      expect(change?.initiative.outcome).toBe("Sync works.");
    }
    for (const state of ["done", "dropped"] as const) {
      expect(() => writeOutcome(anInitiative({ state }), "Sync works.", "by-proposal")).toThrow(
        new InitiativeRefused([`The Initiative is ${state}: it changes no more.`]),
      );
    }
  });
});

describe("the CTO's Tasks and their dependencies", () => {
  const setting = { pipelineId: "full", order: "a3", createdBy: THE_USER };
  const given = { title: "Export endpoint", projectId: "api", priority: "normal" } as const;
  const blocker = aTask({ id: "blocker", projectId: "web" });
  const its = aTask({ id: "its", initiativeId: "initiative-1" });

  it("adds a Task and changes its Tasks' dependencies, the blocker anywhere", () => {
    const initiative = anInitiative();

    expect(addCtoTask(initiative, "straight", "task-9", given, setting, at).task).toMatchObject({
      initiativeId: "initiative-1",
    });
    const added = addDependencyOfItsTask(initiative, "straight", its, "blocker", [its, blocker]);
    expect(added?.task.blockedBy).toEqual(["blocker"]);
    const removed = removeDependencyOfItsTask(
      initiative,
      "straight",
      added?.task ?? its,
      "blocker",
    );
    expect(removed?.task.blockedBy).toEqual([]);
  });

  it("refuses every one straight onto it once it is no longer being shaped", () => {
    const active = anInitiative({ state: "active" });
    const waiting = { ...its, blockedBy: ["blocker"] };
    const refusal = new InitiativeNotShaping(
      "active",
      "its Tasks and their dependencies change straight onto it",
    );

    expect(() => addCtoTask(active, "straight", "task-9", given, setting, at)).toThrow(refusal);
    expect(() =>
      addDependencyOfItsTask(active, "straight", its, "blocker", [its, blocker]),
    ).toThrow(refusal);
    expect(() => removeDependencyOfItsTask(active, "straight", waiting, "blocker")).toThrow(
      refusal,
    );
  });

  it("makes each one by Proposal once it is active", () => {
    const active = anInitiative({ state: "active" });

    expect(addCtoTask(active, "by-proposal", "task-9", given, setting, at).task.id).toBe("task-9");
    const added = addDependencyOfItsTask(active, "by-proposal", its, "blocker", [its, blocker]);
    expect(added?.task.blockedBy).toEqual(["blocker"]);
  });

  it("judges what is asked before the state: a wrong or empty change is never a Proposal", () => {
    const active = anInitiative({ state: "active" });

    expect(() =>
      addCtoTask(active, "straight", "task-9", { ...given, title: " " }, setting, at),
    ).toThrow(TaskRefused);
    expect(() => addDependencyOfItsTask(active, "straight", its, "its", [its])).toThrow(
      TaskRefused,
    );
    expect(removeDependencyOfItsTask(active, "straight", its, "blocker")).toBeUndefined();
  });

  it("changes the dependencies of the Initiative's own Tasks only", () => {
    const other = aTask({ id: "other", title: "Store the queue" });

    expect(() =>
      addDependencyOfItsTask(anInitiative(), "straight", other, "blocker", [other]),
    ).toThrow(
      new InitiativeRefused([`The Task "Store the queue" isn't one of this Initiative's.`]),
    );
    expect(() => removeDependencyOfItsTask(anInitiative(), "straight", other, "blocker")).toThrow(
      InitiativeRefused,
    );
  });
});
