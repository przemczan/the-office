import { describe, expect, it } from "vitest";
import {
  engineInCascade,
  movedProjectLevels,
  roleEngineCascade,
  workInCascade,
  NO_WORK_LEVELS,
  type EngineInCascade,
  type EngineInPlace,
  type LandedEngine,
  type ProjectCascadeLevels,
  type WorkInCascadeLevels,
} from "./engine-cascade.js";

const officeDefault = { engineId: "claude-code", model: "claude-sonnet-5-5" };
const projectDefault = { engineId: "second-account", model: "claude-haiku-5-5" };
const projectRoleOverride = { engineId: "local", model: "qwen3-coder" };
const taskEngine = { engineId: "codex", model: "gpt-6" };
const initiativeEngine = { engineId: "gemini", model: "gemini-4-pro" };

function aProject(levels: Partial<ProjectCascadeLevels> = {}): ProjectCascadeLevels {
  return { projectDefault: null, useForEveryRole: false, roleOverrides: [], ...levels };
}

describe("the engine cascade", () => {
  it("runs on the Office default when no other level is set, naming no model of its own", () => {
    const onOfficeDefault = { engineId: "claude-code", level: "office-default", placeModel: null };

    expect(engineInCascade("developer", { officeDefault })).toEqual(onOfficeDefault);
    expect(engineInCascade("developer", { officeDefault, project: aProject() })).toEqual(
      onOfficeDefault,
    );
  });

  it("takes the Project default over the Office default, with the model it named", () => {
    expect(
      engineInCascade("developer", { officeDefault, project: aProject({ projectDefault }) }),
    ).toEqual({
      engineId: "second-account",
      level: "project-default",
      placeModel: "claude-haiku-5-5",
    });
  });

  it("takes the Project's Role override over every other level, its own Role's only", () => {
    const project = aProject({
      projectDefault,
      useForEveryRole: true,
      roleOverrides: [{ roleKey: "developer", ...projectRoleOverride }],
    });
    const work = { taskEngine, initiativeEngine };

    expect(engineInCascade("developer", { officeDefault, project, work })).toEqual({
      engineId: "local",
      level: "project-role-override",
      placeModel: null,
    });
    expect(engineInCascade("reviewer", { officeDefault, project })).toMatchObject({
      engineId: "second-account",
      level: "project-default",
    });
  });

  it("takes the Task's engine over the Initiative's, and the Initiative's over the Project default", () => {
    const project = aProject({ projectDefault });

    expect(
      engineInCascade("developer", {
        officeDefault,
        project,
        work: { taskEngine, initiativeEngine },
      }),
    ).toEqual({ engineId: "codex", level: "task-engine", placeModel: "gpt-6" });
    expect(
      engineInCascade("developer", {
        officeDefault,
        work: { taskEngine: null, initiativeEngine },
      }),
    ).toEqual({ engineId: "gemini", level: "initiative-engine", placeModel: "gemini-4-pro" });
    expect(
      engineInCascade("developer", { officeDefault, project, work: NO_WORK_LEVELS }),
    ).toMatchObject({ level: "project-default" });
  });

  it("gives none when no level is set, as while no engine is listed", () => {
    expect(engineInCascade("developer", { officeDefault: null, project: aProject() })).toBeNull();
  });
});

describe("movedProjectLevels", () => {
  it("drops levels moved to none, and the force with the Project default", () => {
    const onClaudeCode = { engineId: "claude-code", model: "claude-opus-5-5" };
    const project = aProject({
      projectDefault,
      useForEveryRole: true,
      roleOverrides: [
        { roleKey: "developer", ...projectRoleOverride },
        { roleKey: "reviewer", ...onClaudeCode },
      ],
    });
    const moved = movedProjectLevels(project, (reference) =>
      reference.engineId === "claude-code" ? reference : null,
    );

    expect(moved).toEqual({
      projectDefault: null,
      useForEveryRole: false,
      roleOverrides: [{ roleKey: "reviewer", ...onClaudeCode }],
    });
  });
});

describe("the model and effort cascade", () => {
  const claudeCode: LandedEngine = {
    id: "claude-code",
    kind: "claude-code",
    defaultModel: "claude-sonnet-5-5",
    defaultEffort: "medium",
    models: ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"],
    efforts: ["low", "medium", "high", "xhigh", "max"],
  };
  const onOfficeDefault: EngineInPlace = {
    engineId: "claude-code",
    level: "office-default",
    placeModel: null,
  };

  function working(levels: Partial<WorkInCascadeLevels> = {}): EngineInCascade {
    return workInCascade({
      roleKey: "developer",
      engine: claudeCode,
      inPlace: onOfficeDefault,
      person: {},
      ...levels,
    });
  }

  it("works with the engine's default model and effort when no level sets them", () => {
    expect(working()).toEqual({
      engineId: "claude-code",
      level: "office-default",
      engineType: "claude-code",
      model: "claude-sonnet-5-5",
      modelLevel: "engine",
      effort: "medium",
      effortLevel: "engine",
    });
  });

  it("takes the person's model and effort for the engine's type, each apart", () => {
    expect(
      working({ person: { "claude-code": { model: "claude-opus-5-5", effort: null } } }),
    ).toMatchObject({
      model: "claude-opus-5-5",
      modelLevel: "person",
      effort: "medium",
      effortLevel: "engine",
    });
    expect(working({ person: { "claude-code": { model: null, effort: "max" } } })).toMatchObject({
      model: "claude-sonnet-5-5",
      modelLevel: "engine",
      effort: "max",
      effortLevel: "person",
    });
  });

  it("leaves another type's settings out", () => {
    expect(working({ person: { codex: { model: "gpt-6", effort: "high" } } })).toMatchObject({
      modelLevel: "engine",
      effortLevel: "engine",
    });
  });

  it("puts the model an earlier place level named below the person's", () => {
    const onTask: EngineInPlace = {
      engineId: "claude-code",
      level: "task-engine",
      placeModel: "claude-haiku-5-5",
    };

    expect(working({ inPlace: onTask })).toMatchObject({
      level: "task-engine",
      model: "claude-haiku-5-5",
      modelLevel: "engine",
    });
    expect(
      working({
        inPlace: onTask,
        person: { "claude-code": { model: "claude-opus-5-5", effort: null } },
      }),
    ).toMatchObject({ model: "claude-opus-5-5", modelLevel: "person" });
  });

  it("takes the Project's Role override's model over the person's", () => {
    expect(
      working({
        person: { "claude-code": { model: "claude-opus-5-5", effort: null } },
        project: aProject({
          roleOverrides: [
            { roleKey: "developer", engineId: "claude-code", model: "claude-haiku-5-5" },
          ],
        }),
      }),
    ).toMatchObject({ model: "claude-haiku-5-5", modelLevel: "projectPerson" });
  });

  it("forces Use for every Role's model only on its engine type", () => {
    const project = aProject({ projectDefault, useForEveryRole: true });
    const person = { "claude-code": { model: "claude-opus-5-5", effort: null } };

    expect(working({ person, project, projectDefaultType: "claude-code" })).toMatchObject({
      model: "claude-haiku-5-5",
      modelLevel: "projectForce",
    });
    expect(working({ person, project, projectDefaultType: "codex" })).toMatchObject({
      model: "claude-opus-5-5",
      modelLevel: "person",
    });
  });

  it("takes the Stage's effort over the person's, unless the type doesn't take it", () => {
    const person = { "claude-code": { model: null, effort: "low" } } as const;

    expect(working({ person, stageEffort: "xhigh" })).toMatchObject({
      effort: "xhigh",
      effortLevel: "stage",
    });
    expect(
      working({
        person,
        stageEffort: "max",
        engine: { ...claudeCode, efforts: ["low", "medium", "high"] },
      }),
    ).toMatchObject({ effort: "low", effortLevel: "person" });
  });

  it("gives a model the engine doesn't offer way to the engine's default, naming it", () => {
    expect(
      working({ person: { "claude-code": { model: "claude-opus-4", effort: null } } }),
    ).toMatchObject({
      model: "claude-sonnet-5-5",
      modelLevel: "engine",
      gaveWay: "claude-opus-4",
    });
  });
});

describe("roleEngineCascade", () => {
  const outside: EngineInCascade = {
    engineId: "claude-code",
    level: "office-default",
    engineType: "claude-code",
    model: "claude-sonnet-5-5",
    modelLevel: "engine",
    effort: "high",
    effortLevel: "person",
  };

  it("names only the Projects where the engine, the model or the effort differs", () => {
    const lowerEffort = {
      ...outside,
      effort: "low" as const,
      effortLevel: "projectPerson" as const,
    };
    const otherModel = { ...outside, model: "claude-opus-5-5" };

    expect(
      roleEngineCascade(outside, [
        { projectId: "same", applying: outside },
        { projectId: "effort", applying: lowerEffort },
        { projectId: "model", applying: otherModel },
        { projectId: "nothing-runs", applying: null },
      ]),
    ).toEqual({
      outsideProjects: outside,
      elsewhereInProjects: [
        { projectId: "effort", ...lowerEffort },
        { projectId: "model", ...otherModel },
      ],
    });
  });

  it("gives none outside any Project while no engine is listed", () => {
    expect(roleEngineCascade(null, [])).toEqual({ outsideProjects: null, elsewhereInProjects: [] });
  });
});
