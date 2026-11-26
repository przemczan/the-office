import type { ClaudeCodeEngine, EngineSettings } from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import {
  EACH_PROJECTS_ENGINE,
  NO_ENGINE_LISTED,
  initiativeEngineSummary,
  initiativeEngineToast,
  initiativeTaskEngine,
  noStandInsNote,
  projectEngineOf,
  taskEngineSummary,
  taskEngineToast,
  taskFollowedEngine,
  taskFollowsLine,
} from "./work-engine-words.ts";

const engineName = (engineId: string): string =>
  ({ work: "Work account", personal: "Personal" })[engineId] ?? engineId;

const WORK_ENGINE: ClaudeCodeEngine = {
  id: "work",
  name: "Work account",
  kind: "claude-code",
  defaultModel: "claude-haiku-5-5",
  defaultEffort: null,
  claudeCodeP: false,
};
const FROM_PROJECT = { engineId: "work", from: "project" } as const;
const FROM_OFFICE = { engineId: "work", from: "office" } as const;

describe("the Task's Engine fold's words", () => {
  it("sums up its override, else its Initiative's, else its Project's engine or the Office default", () => {
    const task = { engineOverride: null, initiativeEngineOverride: null, peopleEngineSettings: [] };
    expect(
      taskEngineSummary({ ...task, engineOverride: "personal" }, FROM_PROJECT, engineName),
    ).toBe("Personal · set for this Task · no stand-ins");
    expect(
      taskEngineSummary(
        { ...task, initiativeEngineOverride: "personal" },
        FROM_PROJECT,
        engineName,
      ),
    ).toBe("Personal · from its Initiative · no stand-ins");
    expect(taskEngineSummary(task, FROM_PROJECT, engineName)).toBe(
      "Work account · from the Project",
    );
    expect(taskEngineSummary(task, FROM_OFFICE, engineName)).toBe(
      "Work account · from the Office default",
    );
    expect(taskEngineSummary(task, null, engineName)).toBe(NO_ENGINE_LISTED);
  });

  it("adds that models are set for the Task, whichever engine it follows", () => {
    const task = {
      engineOverride: null,
      initiativeEngineOverride: null,
      peopleEngineSettings: [{ roleKey: "developer", engineSettings: {} }],
    };

    expect(taskEngineSummary(task, FROM_PROJECT, engineName)).toBe(
      "Work account · from the Project · models set for this Task",
    );
    expect(taskEngineSummary({ ...task, engineOverride: "personal" }, null, engineName)).toBe(
      "Personal · set for this Task · no stand-ins · models set for this Task",
    );
  });

  it("names the engine it follows with its switch off, and the stand-ins it has there", () => {
    expect(
      taskFollowsLine(
        taskFollowedEngine({ initiativeEngineOverride: "personal" }, FROM_PROJECT),
        true,
        engineName,
      ),
    ).toBe("Runs on Personal, from its Initiative, with no stand-ins.");
    expect(taskFollowsLine(FROM_PROJECT, true, engineName)).toBe(
      "Runs on Work account, from the Project, with the Project's Stand-in Engines.",
    );
    expect(taskFollowsLine(FROM_OFFICE, false, engineName)).toBe(
      "Runs on Work account, from the Office default, with the Office's Stand-in Engines.",
    );
  });

  it("notes an override has no stand-ins", () => {
    expect(noStandInsNote("work", engineName, "task")).toBe(
      "No stand-ins: when Work account's usage window is used up, the Task waits for the reset.",
    );
    expect(noStandInsNote("work", engineName, "initiative")).toBe(
      "No stand-ins: when Work account's usage window is used up, its Tasks wait for the reset.",
    );
  });

  it("toasts an override saved, and one turned off naming what it follows again", () => {
    const task = { title: "Export Stats as CSV", initiativeEngineOverride: null };
    expect(taskEngineToast(task, "personal", engineName)).toBe(
      "Export Stats as CSV runs on Personal, with no stand-ins.",
    );
    expect(taskEngineToast(task, null, engineName)).toBe(
      "Export Stats as CSV follows its Project's engine again.",
    );
    expect(taskEngineToast({ ...task, initiativeEngineOverride: "work" }, null, engineName)).toBe(
      "Export Stats as CSV follows its Initiative's engine again.",
    );
  });

  it("takes the Project default's engine, else the Office default's, when listed", () => {
    const settings: Pick<EngineSettings, "engines" | "officeDefault"> = {
      engines: [WORK_ENGINE, { ...WORK_ENGINE, id: "personal", name: "Personal" }],
      officeDefault: { engineType: "claude-code", engineId: "work" },
    };
    expect(
      projectEngineOf(
        { engine: { default: { engineType: "claude-code", engineId: "personal" } } },
        settings,
      ),
    ).toEqual({ engineId: "personal", from: "project" });
    expect(projectEngineOf({ engine: { default: null } }, settings)).toEqual(FROM_OFFICE);
    expect(
      projectEngineOf(
        { engine: { default: { engineType: "claude-code", engineId: "gone" } } },
        settings,
      ),
    ).toEqual(FROM_OFFICE);
    expect(projectEngineOf({ engine: { default: null } }, undefined)).toBeNull();
  });
});

describe("the Initiative's Engine fold's words", () => {
  it("sums up its override, else its Project's engine, or each Project's across several", () => {
    const initiative = { engineOverride: null, projectIds: ["the-office"] };
    expect(
      initiativeEngineSummary({ ...initiative, engineOverride: "personal" }, null, engineName),
    ).toBe("Personal · set for this Initiative · no stand-ins");
    expect(initiativeEngineSummary(initiative, FROM_PROJECT, engineName)).toBe(
      "Work account · from the Project",
    );
    expect(initiativeEngineSummary(initiative, FROM_OFFICE, engineName)).toBe(
      "Work account · from the Office default",
    );
    expect(
      initiativeEngineSummary({ ...initiative, projectIds: ["a", "b"] }, null, engineName),
    ).toBe(EACH_PROJECTS_ENGINE);
  });

  it("toasts an override saved, and one turned off", () => {
    expect(initiativeEngineToast({ name: "Usage reports" }, "personal", engineName)).toBe(
      "Usage reports runs on Personal, with no stand-ins.",
    );
    expect(initiativeEngineToast({ name: "Usage reports" }, null, engineName)).toBe(
      "Usage reports has no engine of its own now: its Threads and Tasks run on their Project's engine from their next session.",
    );
  });

  it("says which of its Tasks follow its override and which have their own", () => {
    expect(
      initiativeTaskEngine({ engineOverride: "work" }, { engineOverride: "personal" }, null),
    ).toEqual({ engineId: "work", source: "its own override" });
    expect(
      initiativeTaskEngine({ engineOverride: null }, { engineOverride: "personal" }, null),
    ).toEqual({ engineId: "personal", source: "follows the Initiative's override" });
    expect(
      initiativeTaskEngine({ engineOverride: null }, { engineOverride: null }, FROM_PROJECT),
    ).toEqual({ engineId: "work", source: "its Project's engine" });
  });
});
