import { Test } from "@nestjs/testing";
import { describe, expect, it } from "vitest";
import { EngineModels, NoEngineListed, type EngineModel } from "../../engine/index.js";
import { EngineSettingsForTests } from "../../engine/index.fixtures.js";
import type { ProjectCascadeLevels, ProjectWithCascadeLevels } from "../domain/engine-cascade.js";
import { aRoleCard } from "../domain/role.fixtures.js";
import { RoleNotFound } from "../domain/role-not-found.js";
import { KnownProjectLevels } from "../ports/known-project-levels.js";
import { EngineCascade } from "./engine-cascade.js";
import { RoleCards, type SessionRole } from "./role-cards.js";

const officeDefault = { engineId: "claude-code", model: "claude-sonnet-5-5" };
const projectDefault = { engineId: "claude-code", model: "claude-haiku-5-5" };

async function cascadeWith(
  roleOverride: EngineModel | null,
  office: EngineModel | null = officeDefault,
): Promise<EngineCascade> {
  const roleCards: Pick<RoleCards, "forNewSession"> = {
    forNewSession: async (roleKey): Promise<SessionRole> => {
      if (roleKey !== "developer") throw new RoleNotFound(roleKey);
      return { roleKey, cardVersion: 1, card: aRoleCard({ roleOverride }) };
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
        useValue: new EngineModels(new EngineSettingsForTests({ officeDefault: office })),
      },
      { provide: KnownProjectLevels, useValue: projects },
    ],
  }).compile();
  return moduleRef.get(EngineCascade);
}

describe("EngineCascade", () => {
  it("weighs the Office default and the Role's override in no Project", async () => {
    const opus = { engineId: "claude-code", model: "claude-opus-5-5" };

    await expect((await cascadeWith(null)).of("developer")).resolves.toEqual({
      ...officeDefault,
      level: "office-default",
    });
    await expect((await cascadeWith(opus)).of("developer")).resolves.toEqual({
      ...opus,
      level: "role-override",
    });
  });

  it("weighs the Project's levels in a Project", async () => {
    const cascade = await cascadeWith({ engineId: "claude-code", model: "claude-opus-5-5" });

    await expect(cascade.of("developer", "the-project")).resolves.toEqual({
      ...projectDefault,
      level: "project-default",
    });
  });

  it("lists only the Projects where something else applies", async () => {
    const cascade = await cascadeWith(null);

    await expect(cascade.acrossProjects("developer")).resolves.toEqual({
      outsideProjects: { ...officeDefault, level: "office-default" },
      elsewhereInProjects: [
        { projectId: "the-project", ...projectDefault, level: "project-default" },
      ],
    });
  });

  it("refuses a session in words while no engine is listed, and gives none to ask about", async () => {
    const cascade = await cascadeWith(null, null);

    await expect(cascade.of("developer")).rejects.toThrow(NoEngineListed);
    await expect(cascade.applying("developer")).resolves.toBeNull();
    await expect(cascade.acrossProjects("developer")).resolves.toMatchObject({
      outsideProjects: null,
    });
  });

  it("refuses a Role nobody fills", async () => {
    await expect((await cascadeWith(null)).of("reviewer")).rejects.toThrow(RoleNotFound);
    await expect((await cascadeWith(null)).acrossProjects("reviewer")).rejects.toThrow(
      RoleNotFound,
    );
  });
});
