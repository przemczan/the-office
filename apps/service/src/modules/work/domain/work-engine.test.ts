import { describe, expect, it } from "vitest";
import { InitiativeRefused } from "./initiative-refused.js";
import { initiativeRecordText, taskRecordText } from "./record-words.js";
import { TaskRefused } from "./task-refused.js";
import { anInitiative, aTask } from "./work.fixtures.js";
import {
  changeInitiativeEngine,
  changeTaskEngine,
  inheritedEngineMoves,
  moveTaskEngine,
  tasksOnTheirEngines,
} from "./work-engine.js";

const ON_HAIKU = { engineId: "claude-code", model: "claude-haiku-5-5" };
const ON_QWEN = { engineId: "strata", model: "qwen3.8-flash" };
const NAMES = new Map([
  ["claude-code", "Claude Code"],
  ["strata", "Strata"],
]);

describe("a Task's and an Initiative's engine", () => {
  it("is set until the Task is Done or Dropped, and changes nothing when it is already", () => {
    expect(changeTaskEngine(aTask(), ON_HAIKU)?.task.engine).toEqual(ON_HAIKU);
    expect(changeTaskEngine(aTask({ engine: ON_HAIKU }), { ...ON_HAIKU })).toBeUndefined();
    expect(() => changeTaskEngine(aTask({ state: "dropped" }), null)).toThrow(TaskRefused);
  });

  it("is set until the Initiative is Done or Dropped", () => {
    expect(changeInitiativeEngine(anInitiative(), ON_QWEN)?.initiative.engine).toEqual(ON_QWEN);
    expect(() => changeInitiativeEngine(anInitiative({ state: "done" }), ON_QWEN)).toThrow(
      InitiativeRefused,
    );
  });

  it("moves only the open Tasks that set none of their own as the Initiative's changes", () => {
    const inheriting = aTask({ id: "task-1" });
    const own = aTask({ id: "task-2", engine: ON_HAIKU });
    const done = aTask({ id: "task-3", state: "done" });

    const moves = inheritedEngineMoves([inheriting, own, done], null, ON_QWEN);

    expect(moves).toEqual([
      {
        taskId: "task-1",
        projectId: inheriting.projectId,
        before: { taskEngine: null, initiativeEngine: null },
        after: { taskEngine: null, initiativeEngine: ON_QWEN },
      },
    ]);
    expect(inheritedEngineMoves([inheriting], ON_QWEN, { ...ON_QWEN })).toEqual([]);
  });

  it("lists the open Tasks on their own engine or their Initiative's, as saves above them weigh", () => {
    const own = aTask({ id: "task-1", title: "Fix the login", engine: ON_HAIKU });
    const inheriting = aTask({ id: "task-2", initiativeId: "payments" });
    const atTheProjects = aTask({ id: "task-3" });
    const dropped = aTask({ id: "task-4", state: "dropped", engine: ON_HAIKU });
    const payments = anInitiative({ id: "payments", engine: ON_QWEN });

    const listed = tasksOnTheirEngines([own, inheriting, atTheProjects, dropped], [payments]);

    expect(listed.map(({ task, place, levels }) => [task.id, place, levels])).toEqual([
      ["task-1", "On “Fix the login”", { taskEngine: ON_HAIKU, initiativeEngine: null }],
      ["task-2", `On “${inheriting.title}”`, { taskEngine: null, initiativeEngine: ON_QWEN }],
    ]);
  });

  it("is moved by an engine's removal in any state", () => {
    const moved = moveTaskEngine(aTask({ state: "done", engine: ON_QWEN }), () => null);
    expect(moved?.task.engine).toBeNull();
    expect(moveTaskEngine(aTask(), () => ON_HAIKU)).toBeUndefined();
  });
});

describe("the records' engine lines", () => {
  const parts = {
    attachments: [],
    links: { waitsFor: [], waitingForIt: [], idea: undefined, initiative: undefined },
    stageResults: { lines: [], handoverNotes: [] },
    stateChanges: [],
    decisionsWaiting: [],
    connectedDeviceLines: [],
    engineNames: NAMES,
  };

  it("names the Task's own engine, else its Initiative's, else none", () => {
    const own = taskRecordText(aTask({ engine: ON_HAIKU }), parts).split("\n");
    expect(own).toContain("- Engine: claude-haiku-5-5 on Claude Code");

    const initiative = anInitiative({ engine: ON_QWEN });
    const inherited = taskRecordText(aTask(), { ...parts, links: { ...parts.links, initiative } });
    expect(inherited.split("\n")).toContain(
      "- Engine: the Initiative's engine (qwen3.8-flash on Strata)",
    );

    expect(taskRecordText(aTask(), parts)).not.toContain("- Engine:");
  });

  it("names the Initiative's engine", () => {
    const record = initiativeRecordText({
      initiative: anInitiative({ engine: ON_QWEN }),
      tasks: [],
      blockers: new Map(),
      attachments: [],
      pipelineNames: new Map(),
      engineNames: NAMES,
    });
    expect(record.split("\n")).toContain("- Engine: qwen3.8-flash on Strata");
  });
});
