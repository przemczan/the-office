import { describe, expect, it } from "vitest";
import { initiativeEditProblems, type InitiativeEdit } from "./initiative-edit.js";
import { anInitiative, aTask } from "./work.fixtures.js";

const active = anInitiative({ state: "active", outcome: "Sync works." });
const its = aTask({ id: "its", title: "Queue writes", initiativeId: "initiative-1" });
const blocker = aTask({ id: "blocker", title: "Store the queue", projectId: "web" });
const board = [its, blocker];
const addTask: InitiativeEdit = {
  kind: "add-task",
  title: "Export endpoint",
  projectId: "api",
  priority: "normal",
  blockedBy: ["blocker"],
  taskId: undefined,
};

describe("initiativeEditProblems", () => {
  it("finds none in a change an active Initiative takes", () => {
    const edits: InitiativeEdit[] = [
      { kind: "outcome", outcome: "Writes made offline reach the server." },
      addTask,
      { kind: "add-dependency", taskId: "its", blockerId: "blocker" },
      { kind: "task-title", taskId: "its", title: "Queue every write" },
      { kind: "task-description", taskId: "its", description: "Writes wait for the network." },
    ];

    for (const edit of edits) expect(initiativeEditProblems(active, edit, board)).toEqual([]);
  });

  it("refuses a change of a done or dropped Initiative", () => {
    for (const state of ["done", "dropped"] as const) {
      expect(initiativeEditProblems(anInitiative({ state }), addTask, board)).toEqual([
        `The Initiative is ${state}: it changes no more.`,
      ]);
    }
  });

  it("refuses a change that changes nothing", () => {
    const waiting = { ...its, blockedBy: ["blocker"] };

    expect(
      initiativeEditProblems(active, { kind: "outcome", outcome: "Sync works." }, board),
    ).toEqual(["The Initiative's outcome says so already."]);
    expect(
      initiativeEditProblems(
        active,
        { kind: "add-dependency", taskId: "its", blockerId: "blocker" },
        [waiting, blocker],
      ),
    ).toEqual([`"Queue writes" waits for the Task blocker already.`]);
    expect(
      initiativeEditProblems(
        active,
        { kind: "remove-dependency", taskId: "its", blockerId: "blocker" },
        board,
      ),
    ).toEqual([`"Queue writes" doesn't wait for the Task blocker.`]);
    expect(
      initiativeEditProblems(
        active,
        { kind: "task-title", taskId: "its", title: "Queue writes" },
        board,
      ),
    ).toEqual([`The title of "Queue writes" says so already.`]);
    expect(
      initiativeEditProblems(
        active,
        { kind: "task-description", taskId: "its", description: its.description },
        board,
      ),
    ).toEqual([`The Description of "Queue writes" says so already.`]);
  });

  it("refuses a title or Description by the Task's own rules", () => {
    const started = { ...its, state: "in-progress" } as const;

    expect(
      initiativeEditProblems(active, { kind: "task-title", taskId: "its", title: " " }, board),
    ).toEqual(["Give the Task a title."]);
    expect(
      initiativeEditProblems(active, { kind: "task-title", taskId: "its", title: "New" }, [
        started,
      ]),
    ).toEqual(["A Task keeps its title once it has started."]);
    expect(
      initiativeEditProblems(
        active,
        { kind: "task-description", taskId: "its", description: "New" },
        [started],
      ),
    ).toEqual(["A Task keeps its Description once it has started."]);
    expect(
      initiativeEditProblems(
        active,
        { kind: "task-description", taskId: "blocker", description: "New" },
        board,
      ),
    ).toEqual([`The Task "Store the queue" isn't one of this Initiative's.`]);
  });

  it("refuses by the rules applying it would: another Initiative's Task, an unknown one", () => {
    expect(
      initiativeEditProblems(
        active,
        { kind: "add-dependency", taskId: "blocker", blockerId: "its" },
        board,
      ),
    ).toEqual([`The Task "Store the queue" isn't one of this Initiative's.`]);
    expect(
      initiativeEditProblems(
        active,
        { kind: "remove-dependency", taskId: "gone", blockerId: "its" },
        board,
      ),
    ).toEqual([`There is no Task "gone".`]);
  });

  it("refuses a new Task's wait for a Task that isn't there or was dropped, with its own reasons", () => {
    const dropped = aTask({ id: "dropped", title: "Old queue", state: "dropped" });
    const edit: InitiativeEdit = { ...addTask, title: " ", blockedBy: ["gone", "dropped"] };

    expect(initiativeEditProblems(active, edit, [...board, dropped])).toEqual([
      expect.any(String),
      `There is no Task "gone".`,
      `"Old queue" was dropped, so nothing waits for it.`,
    ]);
  });
});
