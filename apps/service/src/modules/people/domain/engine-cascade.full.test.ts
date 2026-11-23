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
const projectDefault = { engineType: "claude-code", engineId: "second-account" } as const;
const taskEngine = { engineId: "codex", model: "gpt-6" };
const initiativeEngine = { engineId: "gemini", model: "gemini-4-pro" };

const NO_OWN_LIST = { useOwnList: false, engineIds: [] } as const;
const officeStandIns = ["claude-code-2", "codex"];
const fromOffice = { from: "office", engineIds: officeStandIns } as const;

function aProject(levels: Partial<ProjectCascadeLevels> = {}): ProjectCascadeLevels {
  return { default: null, force: null, people: [], standIns: NO_OWN_LIST, ...levels };
}

function forDeveloper(
  engineSettings: ProjectCascadeLevels["people"][number]["engineSettings"],
): ProjectCascadeLevels["people"] {
  return [{ roleKey: "developer", engineSettings }];
}

describe("the engine cascade", () => {
  it("runs on the Office default when no other level is set", () => {
    const onOfficeDefault = {
      engineId: "claude-code",
      level: "office-default",
      standIns: fromOffice,
    };

    expect(engineInCascade({ officeDefault, officeStandIns })).toEqual(onOfficeDefault);
    expect(engineInCascade({ officeDefault, officeStandIns, project: aProject() })).toEqual(
      onOfficeDefault,
    );
  });

  it("takes the Project default's account over the Office default", () => {
    expect(
      engineInCascade({
        officeDefault,
        officeStandIns,
        project: aProject({ default: projectDefault }),
      }),
    ).toEqual({ engineId: "second-account", level: "project-default", standIns: fromOffice });
  });

  it("puts everyone in the place on the same engine, whatever the Project sets for a person", () => {
    const project = aProject({
      default: projectDefault,
      force: { model: "claude-haiku-5-5", effort: null },
      people: [
        { roleKey: "developer", engineSettings: { codex: { model: "gpt-6", effort: null } } },
      ],
    });

    expect(engineInCascade({ officeDefault, officeStandIns, project })).toEqual({
      engineId: "second-account",
      level: "project-default",
      standIns: fromOffice,
    });
  });

  it("takes the Task's engine over the Initiative's, and the Initiative's over the Project default", () => {
    const project = aProject({ default: projectDefault });

    expect(
      engineInCascade({
        officeDefault,
        officeStandIns,
        project,
        work: { taskEngine, initiativeEngine },
      }),
    ).toMatchObject({ engineId: "codex", level: "task-engine" });
    expect(
      engineInCascade({
        officeDefault,
        officeStandIns,
        project,
        work: { taskEngine: null, initiativeEngine },
      }),
    ).toMatchObject({ engineId: "gemini", level: "initiative-engine" });
    expect(
      engineInCascade({ officeDefault, officeStandIns, project, work: NO_WORK_LEVELS }),
    ).toMatchObject({
      level: "project-default",
    });
  });

  it("gives the Project's own Stand-in Engine list while it uses it", () => {
    const project = aProject({ standIns: { useOwnList: true, engineIds: ["gemini"] } });

    expect(engineInCascade({ officeDefault, officeStandIns, project })?.standIns).toEqual({
      from: "project",
      engineIds: ["gemini"],
    });
  });

  it("gives the Office's list in a Project with its own list turned off, keeping it unused", () => {
    const project = aProject({ standIns: { useOwnList: false, engineIds: ["gemini"] } });

    expect(engineInCascade({ officeDefault, officeStandIns, project })?.standIns).toEqual(
      fromOffice,
    );
  });

  it("gives the Office's list outside any Project, and with an empty one an empty list", () => {
    expect(engineInCascade({ officeDefault, officeStandIns })?.standIns).toEqual(fromOffice);
    expect(engineInCascade({ officeDefault, officeStandIns: [] })?.standIns).toEqual({
      from: "office",
      engineIds: [],
    });
  });

  it("gives none when no level is set, as while no engine is listed", () => {
    expect(
      engineInCascade({ officeDefault: null, officeStandIns, project: aProject() }),
    ).toBeNull();
  });
});

describe("movedProjectLevels", () => {
  const force = { model: "claude-haiku-5-5", effort: "low" } as const;
  const people = [
    { roleKey: "developer", engineSettings: { "claude-code": { model: null, effort: "max" } } },
  ] as const;

  it("moves the Project default, keeping the force and the settings for people", () => {
    const moved = movedProjectLevels(aProject({ default: projectDefault, force, people }), () => ({
      engineType: "codex",
      engineId: "codex",
    }));

    expect(moved).toEqual({
      default: { engineType: "codex", engineId: "codex" },
      force,
      people,
      standIns: NO_OWN_LIST,
    });
  });

  it("drops the force with a Project default moved to none", () => {
    expect(
      movedProjectLevels(aProject({ default: projectDefault, force, people }), () => null),
    ).toEqual({ default: null, force: null, people, standIns: NO_OWN_LIST });
  });

  it("moves the Project's own list through the removal's move, used or not", () => {
    const standIns = { useOwnList: false, engineIds: ["codex", "gemini"] };

    expect(
      movedProjectLevels(
        aProject({ standIns }),
        (reference) => reference,
        (engineIds) => engineIds.filter((engineId) => engineId !== "codex"),
      ).standIns,
    ).toEqual({ useOwnList: false, engineIds: ["gemini"] });
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
    standIns: fromOffice,
  };
  const onClaudeCode = { ...projectDefault, engineId: "claude-code" };

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
      standIns: fromOffice,
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

  it("names no model at an engine override: the person's setting for its type applies", () => {
    expect(
      working({
        inPlace: { engineId: "claude-code", level: "task-engine", standIns: fromOffice },
        person: { "claude-code": { model: "claude-opus-5-5", effort: null } },
      }),
    ).toMatchObject({ level: "task-engine", model: "claude-opus-5-5", modelLevel: "person" });
  });

  it("takes the Project's setting for the person over the person's own, each field apart", () => {
    const person = { "claude-code": { model: "claude-opus-5-5", effort: "max" } } as const;

    expect(
      working({
        person,
        project: aProject({
          people: forDeveloper({ "claude-code": { model: "claude-haiku-5-5", effort: null } }),
        }),
      }),
    ).toMatchObject({
      model: "claude-haiku-5-5",
      modelLevel: "projectPerson",
      effort: "max",
      effortLevel: "person",
    });
    expect(
      working({
        person,
        project: aProject({
          people: forDeveloper({ "claude-code": { model: null, effort: "low" } }),
        }),
      }),
    ).toMatchObject({
      model: "claude-opus-5-5",
      modelLevel: "person",
      effort: "low",
      effortLevel: "projectPerson",
    });
  });

  it("leaves the Project's setting for another person or another type out", () => {
    const project = aProject({
      people: [
        {
          roleKey: "reviewer",
          engineSettings: { "claude-code": { model: "claude-haiku-5-5", effort: "low" } },
        },
        { roleKey: "developer", engineSettings: { codex: { model: "gpt-6", effort: "low" } } },
      ],
    });

    expect(working({ project })).toMatchObject({ modelLevel: "engine", effortLevel: "engine" });
  });

  it("takes the force over the Project's setting for the person", () => {
    expect(
      working({
        project: aProject({
          default: onClaudeCode,
          force: { model: "claude-haiku-5-5", effort: "low" },
          people: forDeveloper({ "claude-code": { model: "claude-opus-5-5", effort: "max" } }),
        }),
      }),
    ).toMatchObject({
      model: "claude-haiku-5-5",
      modelLevel: "projectForce",
      effort: "low",
      effortLevel: "projectForce",
    });
  });

  it("forces the engine's default for a field the force leaves unset", () => {
    expect(
      working({
        person: { "claude-code": { model: "claude-opus-5-5", effort: "max" } },
        project: aProject({ default: onClaudeCode, force: { model: null, effort: null } }),
      }),
    ).toMatchObject({
      model: "claude-sonnet-5-5",
      modelLevel: "projectForce",
      effort: "medium",
      effortLevel: "projectForce",
    });
  });

  it("forces only on the Project default's engine type", () => {
    expect(
      working({
        person: { "claude-code": { model: "claude-opus-5-5", effort: null } },
        project: aProject({
          default: { engineType: "codex", engineId: "codex" },
          force: { model: "gpt-6", effort: "low" },
        }),
      }),
    ).toMatchObject({ model: "claude-opus-5-5", modelLevel: "person", effortLevel: "engine" });
  });

  it("takes the Stage's effort over the force, unless the type doesn't take it", () => {
    const project = aProject({ default: onClaudeCode, force: { model: null, effort: "low" } });

    expect(working({ project, stageEffort: "xhigh" })).toMatchObject({
      effort: "xhigh",
      effortLevel: "stage",
    });
    expect(
      working({
        project,
        stageEffort: "max",
        engine: { ...claudeCode, efforts: ["low", "medium", "high"] },
      }),
    ).toMatchObject({ effort: "low", effortLevel: "projectForce" });
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

  it("gives an effort the type doesn't take way to the level below", () => {
    expect(
      working({
        person: { "claude-code": { model: null, effort: "high" } },
        project: aProject({
          people: forDeveloper({ "claude-code": { model: null, effort: "max" } }),
        }),
        engine: { ...claudeCode, efforts: ["low", "medium", "high"] },
      }),
    ).toMatchObject({ effort: "high", effortLevel: "person" });
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
    standIns: fromOffice,
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
