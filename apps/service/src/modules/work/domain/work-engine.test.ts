import { describe, expect, it } from "vitest";
import { InitiativeRefused } from "./initiative-refused.js";
import { initiativeRecordText, taskRecordText } from "./record-words.js";
import { TaskRefused } from "./task-refused.js";
import { anInitiative, aTask } from "./work.fixtures.js";
import {
  changeInitiativeEngine,
  changeTaskEngine,
  inheritedEngineMoves,
  moveInitiativeEngine,
  moveTaskEngine,
  removedEngineChanges,
  tasksOnTheirEngines,
} from "./work-engine.js";

const CLAUDE_CODE = "claude-code";
const STRATA = "strata";
const NAMES = new Map([
  [CLAUDE_CODE, "Claude Code"],
  [STRATA, "Strata"],
]);

describe("a Task's and an Initiative's engine override", () => {
  it("is set until the Task is Done or Dropped, and changes nothing when it is already", () => {
    expect(changeTaskEngine(aTask(), CLAUDE_CODE)?.task.engineOverride).toBe(CLAUDE_CODE);
    expect(changeTaskEngine(aTask({ engineOverride: CLAUDE_CODE }), CLAUDE_CODE)).toBeUndefined();
    expect(
      changeTaskEngine(aTask({ engineOverride: CLAUDE_CODE }), null)?.task.engineOverride,
    ).toBe(null);
    expect(() => changeTaskEngine(aTask({ state: "dropped" }), null)).toThrow(TaskRefused);
    expect(() => changeTaskEngine(aTask({ state: "done" }), STRATA)).toThrow(
      "A Task keeps its engine override once it is Done or Dropped.",
    );
  });

  it("is set until the Initiative is Done or Dropped", () => {
    expect(changeInitiativeEngine(anInitiative(), STRATA)?.initiative.engineOverride).toBe(STRATA);
    expect(
      changeInitiativeEngine(anInitiative({ engineOverride: STRATA }), STRATA),
    ).toBeUndefined();
    expect(() => changeInitiativeEngine(anInitiative({ state: "done" }), STRATA)).toThrow(
      InitiativeRefused,
    );
  });

  it("moves only the open Tasks with no override of their own as the Initiative's changes", () => {
    const inheriting = aTask({ id: "task-1" });
    const own = aTask({ id: "task-2", engineOverride: CLAUDE_CODE });
    const done = aTask({ id: "task-3", state: "done" });

    const moves = inheritedEngineMoves([inheriting, own, done], null, STRATA);

    expect(moves).toEqual([
      {
        taskId: "task-1",
        taskTitle: inheriting.title,
        projectId: inheriting.projectId,
        before: { taskEngineOverride: null, initiativeEngineOverride: null },
        after: { taskEngineOverride: null, initiativeEngineOverride: STRATA },
      },
    ]);
    expect(inheritedEngineMoves([inheriting], STRATA, STRATA)).toEqual([]);
  });

  it("lists the open Tasks under an override, their own or their Initiative's, as saves above them weigh", () => {
    const own = aTask({ id: "task-1", title: "Fix the login", engineOverride: CLAUDE_CODE });
    const inheriting = aTask({ id: "task-2", initiativeId: "payments" });
    const atTheProjects = aTask({ id: "task-3" });
    const dropped = aTask({ id: "task-4", state: "dropped", engineOverride: CLAUDE_CODE });
    const payments = anInitiative({ id: "payments", engineOverride: STRATA });

    const listed = tasksOnTheirEngines([own, inheriting, atTheProjects, dropped], [payments]);

    expect(listed.map(({ task, place, levels }) => [task.id, place, levels])).toEqual([
      [
        "task-1",
        "On “Fix the login”",
        { taskEngineOverride: CLAUDE_CODE, initiativeEngineOverride: null },
      ],
      [
        "task-2",
        `On “${inheriting.title}”`,
        { taskEngineOverride: null, initiativeEngineOverride: STRATA },
      ],
    ]);
  });

  it("is moved by an engine's removal in any state", () => {
    const moved = moveTaskEngine(aTask({ state: "done", engineOverride: STRATA }), () => null);
    expect(moved?.task.engineOverride).toBeNull();
    expect(moveTaskEngine(aTask(), () => CLAUDE_CODE)).toBeUndefined();
    const initiative = anInitiative({ state: "dropped", engineOverride: STRATA });
    expect(moveInitiativeEngine(initiative, () => CLAUDE_CODE)?.initiative.engineOverride).toBe(
      CLAUDE_CODE,
    );
  });

  it("weighs a removal at each Task's own override, then each Initiative's over its Tasks with none", () => {
    const own = aTask({ id: "task-1", title: "Fix the login", engineOverride: STRATA });
    const inheriting = aTask({ id: "task-2", initiativeId: "payments" });
    const payments = anInitiative({ id: "payments", name: "Payments", engineOverride: STRATA });
    const toClaudeCode = (engineId: string) => (engineId === STRATA ? CLAUDE_CODE : engineId);

    const changes = removedEngineChanges(STRATA, [own, inheriting], [payments], toClaudeCode);

    expect(changes.map(({ place, moves }) => [place, moves.map(({ after }) => after)])).toEqual([
      ["On “Fix the login”", [{ taskEngineOverride: CLAUDE_CODE, initiativeEngineOverride: null }]],
      ["In Payments", [{ taskEngineOverride: null, initiativeEngineOverride: CLAUDE_CODE }]],
    ]);
  });
});

describe("the records' engine override lines", () => {
  const parts = {
    attachments: [],
    links: { waitsFor: [], waitingForIt: [], idea: undefined, initiative: undefined },
    stageResults: { lines: [], handoverNotes: [] },
    stateChanges: [],
    decisionsWaiting: [],
    connectedDeviceLines: [],
    engineNames: NAMES,
  };

  it("names the Task's own override, else its Initiative's, else none", () => {
    const own = taskRecordText(aTask({ engineOverride: CLAUDE_CODE }), parts).split("\n");
    expect(own).toContain("- Engine override: Claude Code, set for this Task, no stand-ins");

    const initiative = anInitiative({ engineOverride: STRATA });
    const inherited = taskRecordText(aTask(), { ...parts, links: { ...parts.links, initiative } });
    expect(inherited.split("\n")).toContain(
      "- Engine override: Strata, from its Initiative, no stand-ins",
    );

    expect(taskRecordText(aTask(), parts)).not.toContain("- Engine override:");
  });

  it("names an engine no longer listed by its id", () => {
    const record = taskRecordText(aTask({ engineOverride: "gone" }), parts);
    expect(record.split("\n")).toContain(
      "- Engine override: gone, set for this Task, no stand-ins",
    );
  });

  it("names the Initiative's override", () => {
    const record = initiativeRecordText({
      initiative: anInitiative({ engineOverride: STRATA }),
      tasks: [],
      blockers: new Map(),
      attachments: [],
      pipelineNames: new Map(),
      engineNames: NAMES,
    });
    expect(record.split("\n")).toContain("- Engine override: Strata, no stand-ins");
  });
});
