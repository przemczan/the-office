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
import type {
  ProjectCascadeLevels,
  ProjectWithCascadeLevels,
  WorkCascadeLevels,
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
import { RoleCards, type SessionRole } from "./role-cards.js";
import { MCP_TOOL_DEFAULT_STAND_IN } from "../index.fixtures.js";

const officeDefault = { engineId: "claude-code", model: "claude-sonnet-5-5" };
const projectDefault = { engineId: "claude-code", model: "claude-haiku-5-5" };
const taskEngine = { engineId: "codex", model: "gpt-6-luna" };
const initiativeEngine = { engineId: "gemini", model: "pro" };
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
/** Where the Office default puts the Developer with no settings of their own. */
const onOfficeDefault = {
  ...officeDefault,
  level: "office-default",
  engineType: "claude-code",
  modelLevel: "engine",
  effort: null,
  effortLevel: "engine",
} as const;
/** Where the Project's force puts every person on Claude Code. */
const forcedInTheProject = {
  ...onOfficeDefault,
  model: projectDefault.model,
  level: "project-default",
  modelLevel: "projectForce",
} as const;

/** The Task "the-task" sets its own engine and is in "the-initiative", which sets another. */
class WorkLevelsForTests implements KnownWorkLevels {
  readonly asked: WorkLevelsOf[] = [];

  async engineLevelsOf(of: WorkLevelsOf): Promise<WorkCascadeLevels> {
    this.asked.push(of);
    if ("taskId" in of) {
      return of.taskId === "the-task"
        ? { taskEngine, initiativeEngine }
        : { taskEngine: null, initiativeEngine: null };
    }
    return {
      taskEngine: null,
      initiativeEngine: of.initiativeId === "the-initiative" ? initiativeEngine : null,
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
      return {
        roleKey,
        cardVersion: 1,
        card: aRoleCard({ engineSettings }),
        mcpToolDefault: MCP_TOOL_DEFAULT_STAND_IN,
      };
    },
  };
  const forcedProject: ProjectCascadeLevels = {
    projectDefault,
    useForEveryRole: true,
    roleOverrides: [],
  };
  const projects: KnownProjectLevels = {
    engineLevelsOf: async () => forcedProject,
    engineLevelsOfEveryProject: async (): Promise<readonly ProjectWithCascadeLevels[]> => [
      { projectId: "the-project", projectName: "The project", ...forcedProject },
      {
        projectId: "a-quiet-project",
        projectName: "A quiet project",
        projectDefault: null,
        useForEveryRole: false,
        roleOverrides: [],
      },
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

  it("weighs the Project's levels in a Project", async () => {
    const cascade = await cascadeWith({
      "claude-code": { model: "claude-opus-5-5", effort: "high" },
    });

    await expect(cascade.of("developer", { projectId: "the-project" })).resolves.toEqual({
      ...forcedInTheProject,
      effort: "high",
      effortLevel: "person",
    });
  });

  it("weighs a Task's engine, and its Initiative's, in the Project default's place, the force on its type only", async () => {
    const work = new WorkLevelsForTests();
    const cascade = await cascadeWith({}, officeDefault, work);

    await expect(
      cascade.of("developer", { projectId: "the-project", taskId: "the-task" }),
    ).resolves.toEqual({
      ...taskEngine,
      level: "task-engine",
      engineType: "codex",
      modelLevel: "engine",
      effort: "medium",
      effortLevel: "engine",
    });
    await expect(
      cascade.of("developer", { projectId: "the-project", initiativeId: "the-initiative" }),
    ).resolves.toEqual({
      ...initiativeEngine,
      level: "initiative-engine",
      engineType: "gemini-cli",
      modelLevel: "engine",
      effort: null,
      effortLevel: "engine",
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
    ).resolves.toMatchObject({ ...taskEngine, level: "task-engine" });
    expect(work.asked).toEqual([{ taskId: "the-task" }]);
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

    await expect(cascade.acrossProjects("developer")).resolves.toEqual({
      outsideProjects: onOfficeDefault,
      elsewhereInProjects: [{ projectId: "the-project", ...forcedInTheProject }],
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

  it("refuses a Role nobody fills", async () => {
    await expect((await cascadeWith({})).of("reviewer")).rejects.toThrow(RoleNotFound);
    await expect((await cascadeWith({})).acrossProjects("reviewer")).rejects.toThrow(RoleNotFound);
  });
});
