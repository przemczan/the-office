import { Test } from "@nestjs/testing";
import { describe, expect, it } from "vitest";
import {
  EngineModels,
  FIRST_CLAUDE_CODE_ENGINE,
  NoEngineListed,
  type Engine,
  type EngineModel,
} from "../../engine/index.js";
import { EngineSettingsForTests } from "../../engine/index.fixtures.js";
import {
  NO_STAND_INS,
  type ProjectCascadeLevels,
  type ProjectWithCascadeLevels,
  type WorkCascadeLevels,
} from "../domain/engine-cascade.js";
import type { PersonEngineSettings } from "../domain/role-card.js";
import { aRoleCard } from "../domain/role.fixtures.js";
import { RoleNotFound } from "../domain/role-not-found.js";
import { KnownProjectLevels } from "../ports/known-project-levels.js";
import {
  KnownWorkLevels,
  type TaskOnWorkLevels,
  type WorkLevelsOf,
} from "../ports/known-work-levels.js";
import { EngineCascade } from "./engine-cascade.js";
import { RoleCards, sessionRole, type SessionRole } from "./role-cards.js";
import { MCP_TOOL_DEFAULT_STAND_IN } from "../index.fixtures.js";

const officeDefault = { engineId: "claude-code", model: "claude-sonnet-5-5" };
const projectDefault = { engineType: "claude-code", engineId: "claude-code" } as const;
const forcedModel = "claude-haiku-5-5";
const taskEngineOverride = "codex";
const initiativeEngineOverride = "gemini";
const codex: Engine = {
  id: "codex",
  name: "Codex",
  kind: "codex",
  defaultModel: "gpt-5.6-terra",
  defaultEffort: "medium",
  apiKey: null,
};
const gemini: Engine = {
  id: "gemini",
  name: "Gemini",
  kind: "gemini-cli",
  defaultModel: "auto",
  defaultEffort: null,
  apiKey: null,
};
/** The Office's Stand-in Engine list as stored, which applies unless a Project uses its own. */
const fromOffice = { from: "office", engineIds: ["codex"] } as const;
const NO_OWN_LIST = { useOwnList: false, engineIds: [] } as const;
/** Where the Office default puts the Developer with no settings of their own. */
const onOfficeDefault = {
  ...officeDefault,
  standIns: fromOffice,
  level: "office",
  engineType: "claude-code",
  modelLevel: "engine",
  effort: null,
  effortLevel: "engine",
} as const;
/** Where the Project's force puts every person on Claude Code: its model, the engine's default effort. */
const forcedInTheProject = {
  ...onOfficeDefault,
  model: forcedModel,
  level: "project",
  modelLevel: "projectForce",
  effortLevel: "projectForce",
} as const;

/**
 * The Task "the-task" has its own engine override and is in "the-initiative", which has another;
 * "a-claude-task" is overridden to the Project default's engine type.
 */
class WorkLevelsForTests implements KnownWorkLevels {
  readonly asked: WorkLevelsOf[] = [];

  async engineLevelsOf(of: WorkLevelsOf): Promise<WorkCascadeLevels> {
    this.asked.push(of);
    if ("taskId" in of) {
      if (of.taskId === "the-task") return { taskEngineOverride, initiativeEngineOverride };
      if (of.taskId === "a-claude-task") {
        return { taskEngineOverride: "claude-code", initiativeEngineOverride: null };
      }
      return { taskEngineOverride: null, initiativeEngineOverride: null };
    }
    return {
      taskEngineOverride: null,
      initiativeEngineOverride:
        of.initiativeId === "the-initiative" ? initiativeEngineOverride : null,
    };
  }

  async openTasksOnWorkLevels(): Promise<readonly TaskOnWorkLevels[]> {
    return [];
  }
}

async function cascadeWith(
  engineSettings: PersonEngineSettings,
  office: EngineModel | null = officeDefault,
  work: KnownWorkLevels = new WorkLevelsForTests(),
): Promise<EngineCascade> {
  const roleCards: Pick<RoleCards, "forNewSession"> = {
    forNewSession: async (roleKey): Promise<SessionRole> => {
      if (roleKey !== "developer") throw new RoleNotFound(roleKey);
      return sessionRole(roleKey, 1, aRoleCard({ engineSettings }), MCP_TOOL_DEFAULT_STAND_IN);
    },
  };
  const forcedProject: ProjectCascadeLevels = {
    default: projectDefault,
    force: { model: forcedModel, effort: null },
    people: [],
    standIns: NO_OWN_LIST,
  };
  const quietProject: ProjectCascadeLevels = {
    default: null,
    force: null,
    people: [],
    standIns: { useOwnList: false, engineIds: ["gemini"] },
  };
  const ownListProject: ProjectCascadeLevels = {
    default: null,
    force: null,
    people: [],
    standIns: { useOwnList: true, engineIds: ["gemini"] },
  };
  const personProject: ProjectCascadeLevels = {
    default: null,
    force: null,
    people: [
      { roleKey: "developer", engineSettings: { "claude-code": { model: null, effort: "low" } } },
    ],
    standIns: NO_OWN_LIST,
  };
  const byId: Readonly<Record<string, ProjectCascadeLevels>> = {
    "the-project": forcedProject,
    "a-quiet-project": quietProject,
    "a-person-project": personProject,
    "an-own-list-project": ownListProject,
  };
  const projects: KnownProjectLevels = {
    engineLevelsOf: async (projectId) => byId[projectId] ?? quietProject,
    engineLevelsOfEveryProject: async (): Promise<readonly ProjectWithCascadeLevels[]> => [
      { projectId: "the-project", projectName: "The project", ...forcedProject },
      { projectId: "a-quiet-project", projectName: "A quiet project", ...quietProject },
    ],
  };
  const moduleRef = await Test.createTestingModule({
    providers: [
      EngineCascade,
      { provide: RoleCards, useValue: roleCards },
      {
        provide: EngineModels,
        useValue: new EngineModels(
          new EngineSettingsForTests(
            office === null
              ? { officeDefault: null }
              : {
                  // The Office default runs on its Claude Code engine's default model.
                  engines: [
                    { ...FIRST_CLAUDE_CODE_ENGINE, defaultModel: office.model },
                    codex,
                    gemini,
                  ],
                  officeDefault: { engineType: "claude-code", engineId: office.engineId },
                  standInEngines: ["codex"],
                },
          ),
        ),
      },
      { provide: KnownProjectLevels, useValue: projects },
      { provide: KnownWorkLevels, useValue: work },
    ],
  }).compile();
  return moduleRef.get(EngineCascade);
}

describe("EngineCascade", () => {
  it("weighs the Office default and the person's settings in no Project", async () => {
    const opusAtMax = { "claude-code": { model: "claude-opus-5-5", effort: "max" } } as const;

    await expect((await cascadeWith({})).of("developer")).resolves.toEqual(onOfficeDefault);
    await expect((await cascadeWith(opusAtMax)).of("developer")).resolves.toEqual({
      ...onOfficeDefault,
      model: "claude-opus-5-5",
      modelLevel: "person",
      effort: "max",
      effortLevel: "person",
    });
  });

  it("weighs the Project's force over the person's settings in a Project", async () => {
    const cascade = await cascadeWith({
      "claude-code": { model: "claude-opus-5-5", effort: "high" },
    });

    await expect(cascade.of("developer", { projectId: "the-project" })).resolves.toEqual(
      forcedInTheProject,
    );
  });

  it("weighs the Project's setting for the person over the person's own", async () => {
    const cascade = await cascadeWith({
      "claude-code": { model: "claude-opus-5-5", effort: "high" },
    });

    await expect(cascade.of("developer", { projectId: "a-person-project" })).resolves.toEqual({
      ...onOfficeDefault,
      model: "claude-opus-5-5",
      modelLevel: "person",
      effort: "low",
      effortLevel: "projectPerson",
    });
  });

  it("resolves the one engine a place runs on, whatever the Role", async () => {
    const cascade = await cascadeWith({});

    await expect(cascade.engineAt()).resolves.toEqual({
      engineId: "claude-code",
      engineType: "claude-code",
      engineName: "Claude Code",
      level: "office",
      standIns: fromOffice,
    });
    await expect(cascade.engineAt({ projectId: "the-project" })).resolves.toEqual({
      engineId: "claude-code",
      engineType: "claude-code",
      engineName: "Claude Code",
      level: "project",
      standIns: fromOffice,
    });
    await expect(
      cascade.engineAt({ projectId: "the-project", taskId: "the-task" }),
    ).resolves.toEqual({
      engineId: "codex",
      engineType: "codex",
      engineName: "Codex",
      level: "task",
      standIns: NO_STAND_INS,
    });
    await expect(cascade.engineAt({ initiativeId: "the-initiative" })).resolves.toEqual({
      engineId: "gemini",
      engineType: "gemini-cli",
      engineName: "Gemini",
      level: "initiative",
      standIns: NO_STAND_INS,
    });
    await expect((await cascadeWith({}, null)).engineAt()).resolves.toBeNull();
  });

  it("gives the Stand-in Engine list that applies in a place: a Project's own while it uses it, else the Office's", async () => {
    const cascade = await cascadeWith({});

    await expect(cascade.engineAt({ projectId: "an-own-list-project" })).resolves.toMatchObject({
      standIns: { from: "project", engineIds: ["gemini"] },
    });
    await expect(
      cascade.of("developer", { projectId: "an-own-list-project" }),
    ).resolves.toMatchObject({ standIns: { from: "project", engineIds: ["gemini"] } });
    // Turned off, the Project's list is kept unused.
    await expect(cascade.engineAt({ projectId: "a-quiet-project" })).resolves.toMatchObject({
      standIns: fromOffice,
    });
    await expect(cascade.applying("developer")).resolves.toMatchObject({ standIns: fromOffice });
  });

  it("weighs a Task's engine override over its Initiative's over the Project default, with no stand-ins and the force on the default's type only", async () => {
    const work = new WorkLevelsForTests();
    const cascade = await cascadeWith({}, officeDefault, work);

    await expect(
      cascade.of("developer", { projectId: "the-project", taskId: "the-task" }),
    ).resolves.toEqual({
      engineId: "codex",
      model: codex.defaultModel,
      level: "task",
      engineType: "codex",
      modelLevel: "engine",
      effort: "medium",
      effortLevel: "engine",
      standIns: NO_STAND_INS,
    });
    await expect(
      cascade.of("developer", { projectId: "the-project", initiativeId: "the-initiative" }),
    ).resolves.toEqual({
      engineId: "gemini",
      model: gemini.defaultModel,
      level: "initiative",
      engineType: "gemini-cli",
      modelLevel: "engine",
      effort: null,
      effortLevel: "engine",
      standIns: NO_STAND_INS,
    });
    await expect(
      cascade.applying("developer", { projectId: "the-project", taskId: "a-plain-task" }),
    ).resolves.toEqual(forcedInTheProject);
    expect(work.asked).toEqual([
      { taskId: "the-task" },
      { initiativeId: "the-initiative" },
      { taskId: "a-plain-task" },
    ]);
  });

  it("asks about the Task rather than the Initiative when given both", async () => {
    const work = new WorkLevelsForTests();
    const cascade = await cascadeWith({}, officeDefault, work);

    await expect(
      cascade.of("developer", { taskId: "the-task", initiativeId: "the-initiative" }),
    ).resolves.toMatchObject({ engineId: taskEngineOverride, level: "task" });
    expect(work.asked).toEqual([{ taskId: "the-task" }]);
  });

  it("works with the person's model and effort for the override's engine type", async () => {
    const cascade = await cascadeWith({
      "claude-code": { model: "claude-opus-5-5", effort: "high" },
      codex: { model: "gpt-5.6-terra", effort: "low" },
    });

    await expect(
      cascade.of("developer", { projectId: "the-project", taskId: "the-task" }),
    ).resolves.toMatchObject({
      engineId: "codex",
      level: "task",
      model: "gpt-5.6-terra",
      modelLevel: "person",
      effort: "low",
      effortLevel: "person",
    });
  });

  it("applies the Project's force at an override on the Project default's engine type", async () => {
    const cascade = await cascadeWith({
      "claude-code": { model: "claude-opus-5-5", effort: "high" },
    });

    await expect(
      cascade.of("developer", { projectId: "the-project", taskId: "a-claude-task" }),
    ).resolves.toEqual({ ...forcedInTheProject, level: "task", standIns: NO_STAND_INS });
  });

  it("takes a Stage's effort over the person's", async () => {
    const cascade = await cascadeWith({ "claude-code": { model: null, effort: "low" } });

    await expect(cascade.of("developer", {}, { stageEffort: "xhigh" })).resolves.toMatchObject({
      effort: "xhigh",
      effortLevel: "stage",
    });
  });

  it("lists only the Projects where something else applies", async () => {
    const cascade = await cascadeWith({});

    const named = { engineName: "Claude Code" };
    await expect(cascade.acrossProjects("developer")).resolves.toEqual({
      outsideProjects: { ...onOfficeDefault, ...named },
      elsewhereInProjects: [{ projectId: "the-project", ...forcedInTheProject, ...named }],
    });
  });

  it("refuses a session in words while no engine is listed, and gives none to ask about", async () => {
    const cascade = await cascadeWith({}, null);

    await expect(cascade.of("developer")).rejects.toThrow(NoEngineListed);
    await expect(cascade.applying("developer")).resolves.toBeNull();
    await expect(cascade.acrossProjects("developer")).resolves.toMatchObject({
      outsideProjects: null,
    });
  });

  it("resolves the person's model and effort on a Stand-in Engine of another type, the cascade's level kept", async () => {
    const cascade = await cascadeWith({
      "claude-code": { model: "claude-opus-5-5", effort: "high" },
      codex: { model: null, effort: "low" },
    });

    await expect(cascade.onEngine("developer", "codex")).resolves.toMatchObject({
      engineId: "codex",
      engineType: "codex",
      level: "office",
      model: codex.defaultModel,
      modelLevel: "engine",
      effort: "low",
      effortLevel: "person",
    });
    await expect(cascade.onEngine("developer", "gone")).resolves.toMatchObject({
      engineId: "claude-code",
      model: "claude-opus-5-5",
    });
  });

  it("refuses a Role nobody fills", async () => {
    await expect((await cascadeWith({})).of("reviewer")).rejects.toThrow(RoleNotFound);
    await expect((await cascadeWith({})).acrossProjects("reviewer")).rejects.toThrow(RoleNotFound);
  });
});
