import { describe, expect, it } from "vitest";
import type { EngineCapability } from "../../engine/index.js";
import type { ProjectCascadeLevels } from "./engine-cascade.js";
import {
  incapableEngineProblems,
  newlyOnIncapableEngines,
  rolesOnIncapableEngines,
  standInsInReach,
} from "./pipeline-role-capabilities.js";

const officeDefault = { engineId: "claude-code", model: "claude-sonnet-5-5" };
const local = { engineId: "local", model: "gpt-oss" };
const onLocal = { engineType: "openai-compatible-api", engineId: "local" } as const;
const onClaudeCode = { engineType: "claude-code", engineId: "claude-code" } as const;

/** "local" can't hold an answer to a schema or interrupt; every other engine can do everything. */
function missingCapabilities(engineId: string): readonly EngineCapability[] {
  return engineId === "local" ? ["interrupt", "outputSchema"] : [];
}

function aProject(levels: Partial<ProjectCascadeLevels> = {}): ProjectCascadeLevels {
  return {
    default: null,
    force: null,
    people: [],
    standIns: { useOwnList: false, engineIds: [] },
    ...levels,
  };
}

describe("rolesOnIncapableEngines", () => {
  it("finds the Roles the cascade puts on an engine lacking what Agent Stages need", () => {
    const project = aProject({ default: onLocal });

    expect(
      rolesOnIncapableEngines(
        ["developer", "reviewer"],
        { officeDefault, officeStandIns: [], project },
        missingCapabilities,
      ),
    ).toEqual([
      { roleKey: "developer", engineId: "local", missing: ["outputSchema"] },
      { roleKey: "reviewer", engineId: "local", missing: ["outputSchema"] },
    ]);
  });

  it("weighs the force and the settings for people as models and efforts only, never engines", () => {
    const project = aProject({
      default: onClaudeCode,
      force: { model: "gpt-oss", effort: null },
      people: [
        { roleKey: "reviewer", engineSettings: { codex: { model: "gpt-6", effort: null } } },
      ],
    });

    expect(
      rolesOnIncapableEngines(
        ["developer", "reviewer"],
        { officeDefault: local, officeStandIns: [], project },
        missingCapabilities,
      ),
    ).toEqual([]);
  });

  it("weighs the Office default alone outside any Project", () => {
    expect(
      rolesOnIncapableEngines(
        ["developer"],
        { officeDefault: local, officeStandIns: [] },
        missingCapabilities,
      ),
    ).toEqual([{ roleKey: "developer", engineId: "local", missing: ["outputSchema"] }]);
    expect(
      rolesOnIncapableEngines(
        ["developer"],
        { officeDefault, officeStandIns: [] },
        missingCapabilities,
      ),
    ).toEqual([]);
  });

  it("weighs a Task's engine over the Project's default", () => {
    const project = aProject({ default: onClaudeCode });

    expect(
      rolesOnIncapableEngines(
        ["developer"],
        {
          officeDefault,
          officeStandIns: [],
          project,
          work: { taskEngine: local, initiativeEngine: null },
        },
        missingCapabilities,
      ),
    ).toEqual([{ roleKey: "developer", engineId: "local", missing: ["outputSchema"] }]);
  });

  it("weighs each Stand-in Engine of the Office's list outside any Project, as standing in", () => {
    expect(
      rolesOnIncapableEngines(
        ["developer"],
        { officeDefault, officeStandIns: ["claude-code-2", "local"] },
        missingCapabilities,
      ),
    ).toEqual([
      { roleKey: "developer", engineId: "local", missing: ["outputSchema"], standIn: true },
    ]);
  });

  it("weighs the Project's own list in it while it uses it, else the Office's", () => {
    const ownList = { useOwnList: true, engineIds: ["local"] };

    expect(
      rolesOnIncapableEngines(
        ["developer"],
        { officeDefault, officeStandIns: [], project: aProject({ standIns: ownList }) },
        missingCapabilities,
      ),
    ).toEqual([
      { roleKey: "developer", engineId: "local", missing: ["outputSchema"], standIn: true },
    ]);
    expect(
      rolesOnIncapableEngines(
        ["developer"],
        {
          officeDefault,
          officeStandIns: [],
          project: aProject({ standIns: { ...ownList, useOwnList: false } }),
        },
        missingCapabilities,
      ),
    ).toEqual([]);
  });

  it("weighs the cascade's own engine once, never as its own stand-in", () => {
    expect(
      rolesOnIncapableEngines(
        ["developer"],
        { officeDefault: local, officeStandIns: ["local"] },
        missingCapabilities,
      ),
    ).toEqual([{ roleKey: "developer", engineId: "local", missing: ["outputSchema"] }]);
  });

  it("leaves the list out when it is weighed in another place", () => {
    expect(
      rolesOnIncapableEngines(
        ["developer"],
        { officeDefault, officeStandIns: ["local"] },
        missingCapabilities,
        { standIns: false },
      ),
    ).toEqual([]);
  });
});

describe("standInsInReach", () => {
  it("gives the list that applies, less the cascade's own engine and any engine named twice", () => {
    expect(
      standInsInReach({
        engineId: "claude-code",
        level: "office-default",
        standIns: { from: "office", engineIds: ["codex", "claude-code", "codex", "local"] },
      }),
    ).toEqual(["codex", "local"]);
  });
});

describe("newlyOnIncapableEngines", () => {
  it("keeps only the Roles that weren't on an incapable engine before", () => {
    const developer = {
      roleKey: "developer",
      engineId: "local",
      missing: ["outputSchema"] as const,
    };
    const reviewer = { roleKey: "reviewer", engineId: "local", missing: ["outputSchema"] as const };

    expect(newlyOnIncapableEngines([developer], [developer, reviewer])).toEqual([reviewer]);
  });

  it("counts a Role on an incapable stand-in apart from its cascade's engine, and on each stand-in", () => {
    const onCascade = {
      roleKey: "developer",
      engineId: "local",
      missing: ["officeTools"] as const,
    };
    const standingIn = { ...onCascade, standIn: true as const };
    const onAnother = { ...standingIn, engineId: "other" };

    expect(newlyOnIncapableEngines([onCascade], [onCascade, standingIn])).toEqual([standingIn]);
    expect(newlyOnIncapableEngines([standingIn], [standingIn, onAnother])).toEqual([onAnother]);
    expect(newlyOnIncapableEngines([standingIn], [standingIn])).toEqual([]);
  });
});

describe("incapableEngineProblems", () => {
  const names = {
    roleTitle: (roleKey: string) => (roleKey === "developer" ? "Developer" : "Reviewer"),
    engineName: (engineId: string) => (engineId === "local" ? "Local models" : engineId),
  };

  it("names the engine, what it lacks, the Roles on it once each and the Project", () => {
    const problems = incapableEngineProblems(
      [
        { roleKey: "developer", engineId: "local", missing: ["officeTools"] },
        { roleKey: "reviewer", engineId: "local", missing: ["officeTools"] },
        { roleKey: "developer", engineId: "local", missing: ["officeTools"] },
      ],
      { ...names, projectName: "Admin panel" },
    );

    expect(problems).toEqual([
      "Local models can't use Office tools, which the Agent Stages of the Developer and the Reviewer need in Admin panel.",
    ]);
  });

  it("says outside any Project when there is none, and a schema it can't hold its answer to", () => {
    const problems = incapableEngineProblems(
      [{ roleKey: "developer", engineId: "local", missing: ["outputSchema"] }],
      { ...names, projectName: undefined },
    );

    expect(problems).toEqual([
      "Local models can't hold its answer to the Stage result's schema, which the Agent Stages of the Developer need outside any Project.",
    ]);
  });

  it("names both when the engine lacks both", () => {
    const problems = incapableEngineProblems(
      [{ roleKey: "reviewer", engineId: "local", missing: ["officeTools", "outputSchema"] }],
      { ...names, projectName: "Admin panel" },
    );

    expect(problems).toEqual([
      "Local models can't use Office tools or hold its answer to the Stage result's schema, which the Agent Stages of the Reviewer need in Admin panel.",
    ]);
  });

  it("says it on a Task", () => {
    const problems = incapableEngineProblems(
      [{ roleKey: "developer", engineId: "local", missing: ["officeTools"] }],
      { ...names, projectName: "Admin panel", place: "On “Fix the login”" },
    );

    expect(problems).toEqual([
      "On “Fix the login”, Local models can't use Office tools, which the Agent Stages of the Developer need.",
    ]);
  });

  it("says it in an Initiative, on the Tasks it was found on", () => {
    const problems = incapableEngineProblems(
      [
        {
          roleKey: "developer",
          engineId: "local",
          missing: ["officeTools"],
          taskTitle: "Fix the login",
        },
        {
          roleKey: "developer",
          engineId: "local",
          missing: ["officeTools"],
          taskTitle: "Add a refund",
        },
      ],
      { ...names, projectName: undefined, place: "In Payments" },
    );

    expect(problems).toEqual([
      "In Payments, Local models can't use Office tools, which the Agent Stages of the Developer need on “Fix the login” and “Add a refund”.",
    ]);
  });

  it("says a Stand-in Engine can't stand in, apart from the cascade's engine", () => {
    const problems = incapableEngineProblems(
      [
        { roleKey: "developer", engineId: "local", missing: ["officeTools"] },
        { roleKey: "developer", engineId: "local", missing: ["officeTools"], standIn: true },
      ],
      { ...names, projectName: "Admin panel" },
    );

    expect(problems).toEqual([
      "Local models can't use Office tools, which the Agent Stages of the Developer need in Admin panel.",
      "Local models can't stand in: it can't use Office tools, which the Agent Stages of the Developer need in Admin panel.",
    ]);
  });

  it("says a stand-in can't hold its answer outside any Project, and on a Task", () => {
    const standingIn = {
      roleKey: "developer",
      engineId: "local",
      missing: ["outputSchema"],
      standIn: true,
    } as const;

    expect(incapableEngineProblems([standingIn], { ...names, projectName: undefined })).toEqual([
      "Local models can't stand in: it can't hold its answer to the Stage result's schema, which the Agent Stages of the Developer need outside any Project.",
    ]);
    expect(
      incapableEngineProblems([standingIn], {
        ...names,
        projectName: undefined,
        place: "On “Fix the login”",
      }),
    ).toEqual([
      "On “Fix the login”, Local models can't stand in: it can't hold its answer to the Stage result's schema, which the Agent Stages of the Developer need.",
    ]);
  });
});
