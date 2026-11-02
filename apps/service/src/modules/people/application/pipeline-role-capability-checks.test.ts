import { Test } from "@nestjs/testing";
import { beforeEach, describe, expect, it } from "vitest";
import {
  EngineModels,
  EngineSessions,
  type Engine,
  type EngineCapability,
  type EngineModel,
} from "../../engine/index.js";
import type { ProjectCascadeLevels } from "../domain/engine-cascade.js";
import { aRoleCard } from "../domain/role.fixtures.js";
import { KnownPipelineRoles } from "../ports/known-pipeline-roles.js";
import { ProjectLevelsSaves, type ProjectLevelsSave } from "../ports/project-levels-saves.js";
import { PipelineRoleCapabilityChecks } from "./pipeline-role-capability-checks.js";
import { RoleCards, type SessionRole } from "./role-cards.js";

const officeDefault = { engineId: "claude-code", model: "claude-sonnet-5-5" };
const local = { engineId: "local", model: "gpt-oss" };
const engines: readonly Engine[] = [
  {
    id: "claude-code",
    name: "Claude Code",
    kind: "claude-code",
    defaultModel: "",
    claudeCodeP: false,
  },
  { id: "local", name: "Local models", kind: "claude-code", defaultModel: "", claudeCodeP: false },
];
/** The Developer has an Office-wide Role override on Claude Code; the CTO is in no Pipeline. */
const roleOverrides: Readonly<Record<string, EngineModel>> = { developer: officeDefault };

let check: (save: ProjectLevelsSave) => Promise<readonly string[]>;

beforeEach(async () => {
  const roleCards: Pick<RoleCards, "find" | "roleTitle"> = {
    find: async (roleKey): Promise<SessionRole | undefined> =>
      roleKey === "reviewer"
        ? undefined
        : {
            roleKey,
            cardVersion: 1,
            card: aRoleCard({ roleOverride: roleOverrides[roleKey] ?? null }),
          },
    roleTitle: (roleKey) => roleKey.charAt(0).toUpperCase() + roleKey.slice(1),
  };
  const engineModels: Pick<EngineModels, "engines" | "officeDefault"> = {
    engines: async () => engines,
    officeDefault: async () => officeDefault,
  };
  const engineSessions: Pick<EngineSessions, "missingCapabilitiesOf"> = {
    missingCapabilitiesOf: (engine): readonly EngineCapability[] =>
      engine.id === "local" ? ["officeTools"] : [],
  };
  const pipelineRoles: KnownPipelineRoles = {
    rolesNamed: async () => new Set(["developer", "reviewer"]),
  };
  const saves: ProjectLevelsSaves = {
    register: (registered) => {
      check = registered;
    },
  };
  const moduleRef = await Test.createTestingModule({
    providers: [
      PipelineRoleCapabilityChecks,
      { provide: RoleCards, useValue: roleCards },
      { provide: EngineModels, useValue: engineModels },
      { provide: EngineSessions, useValue: engineSessions },
      { provide: KnownPipelineRoles, useValue: pipelineRoles },
      { provide: ProjectLevelsSaves, useValue: saves },
    ],
  }).compile();
  await moduleRef.init();
});

function aSave(before: Partial<ProjectCascadeLevels>, after: Partial<ProjectCascadeLevels>) {
  const levels = { projectDefault: null, useForEveryRole: false, roleOverrides: [] };
  return {
    projectId: "admin-panel",
    projectName: "Admin panel",
    before: { ...levels, ...before },
    after: { ...levels, ...after },
  };
}

describe("PipelineRoleCapabilityChecks on a save of a Project's levels", () => {
  it("refuses a Project default that puts a Role a Pipeline names on an incapable engine", async () => {
    await expect(check(aSave({}, { projectDefault: local }))).resolves.toEqual([
      "In Admin panel, the Reviewer would run on Local models, which can't use Office tools, as their Pipelines' Agent Stages need.",
    ]);
  });

  it("refuses the force that puts a Role override's Role there too", async () => {
    await expect(
      check(aSave({ projectDefault: local }, { projectDefault: local, useForEveryRole: true })),
    ).resolves.toEqual([
      "In Admin panel, the Developer would run on Local models, which can't use Office tools, as their Pipelines' Agent Stages need.",
    ]);
  });

  it("lets through a Role no Pipeline names, and a Role already there", async () => {
    const onLocal = [{ roleKey: "cto", ...local }];
    const reviewerOnLocal = [{ roleKey: "reviewer", ...local }];

    await expect(check(aSave({}, { roleOverrides: onLocal }))).resolves.toEqual([]);
    await expect(
      check(
        aSave(
          { roleOverrides: reviewerOnLocal },
          { roleOverrides: [...reviewerOnLocal, ...onLocal] },
        ),
      ),
    ).resolves.toEqual([]);
  });
});
