import { Test } from "@nestjs/testing";
import { beforeEach, describe, expect, it } from "vitest";
import {
  CODEX_CAPABILITIES,
  GEMINI_CLI_CAPABILITIES,
  EngineModels,
  EngineSessions,
  EngineSettingsChecks,
  type Engine,
  type EngineCapability,
  type EngineModel,
} from "../../engine/index.js";
import type { ProjectCascadeLevels, ProjectWithCascadeLevels } from "../domain/engine-cascade.js";
import type { PipelineRolesNamed } from "../domain/pipeline-roles-named.js";
import { aRoleCard } from "../domain/role.fixtures.js";
import { KnownProjectLevels } from "../ports/known-project-levels.js";
import { ProjectLevelsSaves, type ProjectLevelsSave } from "../ports/project-levels-saves.js";
import { PipelineRoleCapabilityChecks } from "./pipeline-role-capability-checks.js";
import { PipelineRoleSources } from "./pipeline-role-sources.js";
import { RoleCards, type SessionRole } from "./role-cards.js";
import { RoleOverrideChecks } from "./role-override-checks.js";
import type { DutyKey } from "../domain/duties.js";
import { Duties } from "./duties.js";
import { DutyChangeChecks } from "./duty-change-checks.js";
import { MCP_TOOL_DEFAULT_STAND_IN } from "../index.fixtures.js";

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
const codex: Engine = {
  id: "codex",
  name: "Codex",
  kind: "codex",
  defaultModel: "gpt-6-luna",
  apiKey: null,
};
const gemini: Engine = {
  id: "gemini",
  name: "Gemini",
  kind: "gemini-cli",
  defaultModel: "auto",
  apiKey: null,
};
const onGemini = { engineId: gemini.id, model: "auto" };
/** What the Gemini CLI adapter declares it can't do. */
const missingOnGemini = (
  Object.keys(GEMINI_CLI_CAPABILITIES) as (keyof typeof GEMINI_CLI_CAPABILITIES)[]
).filter((capability) => !GEMINI_CLI_CAPABILITIES[capability]);
const onCodex = { engineId: codex.id, model: "gpt-6-luna" };
/** What the Codex adapter declares it can't do. */
const missingOnCodex = (
  Object.keys(CODEX_CAPABILITIES) as (keyof typeof CODEX_CAPABILITIES)[]
).filter((capability) => !CODEX_CAPABILITIES[capability]);
/** The Developer has an Office-wide Role override on Claude Code; the CTO is in no Pipeline. */
const roleOverrides: Readonly<Record<string, EngineModel>> = { developer: officeDefault };

/** Admin panel puts every Role on Local models; Billing leaves them to the Office levels. */
const projectLevels = [
  {
    projectId: "admin-panel",
    projectName: "Admin panel",
    projectDefault: local,
    useForEveryRole: false,
    roleOverrides: [],
  },
  {
    projectId: "billing",
    projectName: "Billing",
    projectDefault: null,
    useForEveryRole: false,
    roleOverrides: [],
  },
];

/** Projects a test adds after the two above. */
let moreProjects: ProjectWithCascadeLevels[];
let check: (save: ProjectLevelsSave) => Promise<readonly string[]>;
let roleOverrideChecks: RoleOverrideChecks;
let engineSettingsChecks: EngineSettingsChecks;
let checks: PipelineRoleCapabilityChecks;
/** The library names the Developer and the Reviewer; a test adds open Tasks' Roles by Project. */
let rolesNamed: PipelineRolesNamed;
/** Who holds each duty: the Developer Implements; a test sets others. */
let dutyHolders: Map<DutyKey, string>;
let dutyChangeChecks: DutyChangeChecks;

/** The CTO named by an open Task's own Stages in the Project, as Pipelines would tell it. */
function ctoNamedByATaskIn(projectId: string): void {
  rolesNamed = { ...rolesNamed, byProject: new Map([[projectId, new Set(["cto"])]]) };
}

beforeEach(async () => {
  const roleCards: Pick<RoleCards, "find" | "roleTitle"> = {
    find: async (roleKey): Promise<SessionRole | undefined> =>
      roleKey === "reviewer"
        ? undefined
        : {
            roleKey,
            cardVersion: 1,
            mcpToolDefault: MCP_TOOL_DEFAULT_STAND_IN,
            card: aRoleCard({ roleOverride: roleOverrides[roleKey] ?? null }),
          },
    roleTitle: (roleKey) => roleKey.charAt(0).toUpperCase() + roleKey.slice(1),
  };
  const engineModels: Pick<EngineModels, "engines" | "officeDefault"> = {
    // Codex is listed too, for a Role override on it.
    engines: async () => [...engines, codex, gemini],
    officeDefault: async () => officeDefault,
  };
  const engineSessions: Pick<EngineSessions, "missingCapabilitiesOf"> = {
    missingCapabilitiesOf: (engine): readonly EngineCapability[] =>
      engine.kind === "codex"
        ? missingOnCodex
        : engine.kind === "gemini-cli"
          ? missingOnGemini
          : engine.id === "local"
            ? ["officeTools"]
            : [],
  };
  rolesNamed = { everywhere: new Set(["developer", "reviewer"]), byProject: new Map() };
  dutyHolders = new Map([["implements", "developer"]]);
  moreProjects = [];
  const projects: KnownProjectLevels = {
    engineLevelsOf: async () => projectLevels[0]!,
    engineLevelsOfEveryProject: async () => [...projectLevels, ...moreProjects],
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
      PipelineRoleSources,
      { provide: KnownProjectLevels, useValue: projects },
      { provide: ProjectLevelsSaves, useValue: saves },
      RoleOverrideChecks,
      EngineSettingsChecks,
      { provide: Duties, useValue: { holders: async () => dutyHolders } },
      DutyChangeChecks,
    ],
  }).compile();
  moduleRef.get(PipelineRoleSources).register(async () => rolesNamed);
  await moduleRef.init();
  roleOverrideChecks = moduleRef.get(RoleOverrideChecks);
  engineSettingsChecks = moduleRef.get(EngineSettingsChecks);
  checks = moduleRef.get(PipelineRoleCapabilityChecks);
  dutyChangeChecks = moduleRef.get(DutyChangeChecks);
});

/** The library's Stages name `duty` too, outside any Project and in every one. */
function dutyNamedByTheLibrary(duty: DutyKey): void {
  rolesNamed = { ...rolesNamed, duties: { everywhere: new Set([duty]), byProject: new Map() } };
}

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

  it("counts an open Task's Roles in its own Project only", async () => {
    const ctoOnLocal = { roleOverrides: [{ roleKey: "cto", ...local }] };

    ctoNamedByATaskIn("admin-panel");
    await expect(check(aSave({}, ctoOnLocal))).resolves.toEqual([
      "In Admin panel, the Cto would run on Local models, which can't use Office tools, as their Pipelines' Agent Stages need.",
    ]);
    ctoNamedByATaskIn("billing");
    await expect(check(aSave({}, ctoOnLocal))).resolves.toEqual([]);
  });
});

describe("PipelineRoleCapabilityChecks on a save of a Role override", () => {
  it("refuses one that puts a Role a Pipeline names on an incapable engine, naming each place", async () => {
    await expect(
      roleOverrideChecks.problemsOf({ roleKey: "reviewer", before: null, after: local }),
    ).resolves.toEqual([
      "Outside any Project, the Reviewer would run on Local models, which can't use Office tools, as their Pipelines' Agent Stages need.",
      "In Billing, the Reviewer would run on Local models, which can't use Office tools, as their Pipelines' Agent Stages need.",
    ]);
  });

  it("refuses removing one that kept a Role off the incapable engine a Project gives", async () => {
    await expect(
      roleOverrideChecks.problemsOf({ roleKey: "developer", before: officeDefault, after: null }),
    ).resolves.toEqual([
      "In Admin panel, the Developer would run on Local models, which can't use Office tools, as their Pipelines' Agent Stages need.",
    ]);
  });

  it("lets through a Role no Pipeline names", async () => {
    await expect(
      roleOverrideChecks.problemsOf({ roleKey: "cto", before: null, after: local }),
    ).resolves.toEqual([]);
  });

  it("lets through no Role override before or after, as a preset hire brings, even where the Role runs on an incapable engine", async () => {
    await expect(
      roleOverrideChecks.problemsOf({ roleKey: "reviewer", before: null, after: null }),
    ).resolves.toEqual([]);
  });

  it("weighs a Role only an open Task names in the Task's Project only", async () => {
    ctoNamedByATaskIn("billing");

    await expect(
      roleOverrideChecks.problemsOf({ roleKey: "cto", before: null, after: local }),
    ).resolves.toEqual([
      "In Billing, the Cto would run on Local models, which can't use Office tools, as their Pipelines' Agent Stages need.",
    ]);
  });
});

describe("PipelineRoleCapabilityChecks on a save of Settings › Engines", () => {
  const settings = { engines, officeDefault };

  it("weighs a removal's moved Role overrides", async () => {
    const [claudeCode, localModels] = engines;

    await expect(
      engineSettingsChecks.problemsOf({
        before: settings,
        // Only the Developer's Role override names Claude Code: an engine not listed is left alone.
        after: { engines: [localModels!], officeDefault },
        removal: { engineId: claudeCode!.id, replacement: localModels! },
      }),
    ).resolves.toEqual([
      "Outside any Project, the Developer would run on Local models, which can't use Office tools, as their Pipelines' Agent Stages need.",
      "In Admin panel, the Developer would run on Local models, which can't use Office tools, as their Pipelines' Agent Stages need.",
      "In Billing, the Developer would run on Local models, which can't use Office tools, as their Pipelines' Agent Stages need.",
    ]);
  });

  it("weighs a removal's moved Project levels", async () => {
    const spare: Engine = { ...engines[0]!, id: "spare", name: "Spare" };
    moreProjects = [
      {
        projectId: "shop",
        projectName: "Shop",
        projectDefault: null,
        useForEveryRole: false,
        roleOverrides: [{ roleKey: "reviewer", engineId: "spare", model: "claude-haiku-5-5" }],
      },
    ];

    await expect(
      engineSettingsChecks.problemsOf({
        before: { engines: [...engines, spare], officeDefault },
        after: settings,
        removal: { engineId: "spare", replacement: engines[1]! },
      }),
    ).resolves.toEqual([
      "In Shop, the Reviewer would run on Local models, which can't use Office tools, as their Pipelines' Agent Stages need.",
    ]);
  });

  it("refuses an Office default that puts the Roles a Pipeline names on an incapable engine", async () => {
    await expect(
      engineSettingsChecks.problemsOf({
        before: settings,
        after: { ...settings, officeDefault: local },
      }),
    ).resolves.toEqual([
      "Outside any Project, the Reviewer would run on Local models, which can't use Office tools, as their Pipelines' Agent Stages need.",
      "In Billing, the Reviewer would run on Local models, which can't use Office tools, as their Pipelines' Agent Stages need.",
    ]);
  });

  it("names the engine as the save leaves it", async () => {
    const renamed = engines.map((engine) =>
      engine.id === "local" ? { ...engine, name: "Workstation models" } : engine,
    );

    await expect(
      engineSettingsChecks.problemsOf({
        before: settings,
        after: { engines: renamed, officeDefault: local },
      }),
    ).resolves.toContain(
      "Outside any Project, the Reviewer would run on Workstation models, which can't use Office tools, as their Pipelines' Agent Stages need.",
    );
  });

  it("weighs a Role only an open Task names in the Task's Project only", async () => {
    ctoNamedByATaskIn("billing");

    await expect(
      engineSettingsChecks.problemsOf({
        before: settings,
        after: { ...settings, officeDefault: local },
      }),
    ).resolves.toEqual([
      "Outside any Project, the Reviewer would run on Local models, which can't use Office tools, as their Pipelines' Agent Stages need.",
      "In Billing, the Reviewer and the Cto would run on Local models, which can't use Office tools, as their Pipelines' Agent Stages need.",
    ]);
  });

  it("lets through an Office default on a Codex engine, which has Office tools and output schemas", async () => {
    const withCodex = { engines: [...engines, codex], officeDefault };

    await expect(
      engineSettingsChecks.problemsOf({
        before: withCodex,
        after: { ...withCodex, officeDefault: onCodex },
      }),
    ).resolves.toEqual([]);
    await expect(
      roleOverrideChecks.problemsOf({ roleKey: "reviewer", before: null, after: onCodex }),
    ).resolves.toEqual([]);
  });

  it("lets through an Office default on a Gemini CLI engine, which lacks only what no Pipeline Role needs", async () => {
    const withGemini = { engines: [...engines, gemini], officeDefault };

    await expect(
      engineSettingsChecks.problemsOf({
        before: withGemini,
        after: { ...withGemini, officeDefault: onGemini },
      }),
    ).resolves.toEqual([]);
    await expect(
      roleOverrideChecks.problemsOf({ roleKey: "reviewer", before: null, after: onGemini }),
    ).resolves.toEqual([]);
  });

  it("lets through a save that changes nothing for the Roles a Pipeline names", async () => {
    await expect(
      engineSettingsChecks.problemsOf({ before: settings, after: settings }),
    ).resolves.toEqual([]);
  });
});

describe("PipelineRoleCapabilityChecks on Roles a save of Stages newly names", () => {
  it("weighs a library Stage's Role outside any Project and in every Project", async () => {
    await expect(
      checks.newlyNamedRolesProblems({ roleKeys: ["cto", "developer"], projectId: undefined }),
    ).resolves.toEqual([
      "In Admin panel, the Cto would run on Local models, which can't use Office tools, as their Pipelines' Agent Stages need.",
    ]);
  });

  it("weighs a Task's Stage's Role in the Task's Project only", async () => {
    await expect(
      checks.newlyNamedRolesProblems({ roleKeys: ["cto"], projectId: "billing" }),
    ).resolves.toEqual([]);
    await expect(
      checks.newlyNamedRolesProblems({ roleKeys: ["cto"], projectId: "admin-panel" }),
    ).resolves.toHaveLength(1);
  });

  it("lets through a Role an open Task already names in the place", async () => {
    ctoNamedByATaskIn("admin-panel");

    await expect(
      checks.newlyNamedRolesProblems({ roleKeys: ["cto"], projectId: "admin-panel" }),
    ).resolves.toEqual([]);
    await expect(
      checks.newlyNamedRolesProblems({ roleKeys: ["cto"], projectId: undefined }),
    ).resolves.toEqual([]);
  });

  it("weighs a Role's own override", async () => {
    await expect(
      checks.newlyNamedRolesProblems({ roleKeys: ["developer"], projectId: "admin-panel" }),
    ).resolves.toEqual([]);
  });
});

describe("PipelineRoleCapabilityChecks on Stages naming a duty", () => {
  const CTO_ON_LOCAL =
    "In Admin panel, the Cto would run on Local models, which can't use Office tools, as their Pipelines' Agent Stages need.";

  it("weighs a duty a save of Stages newly names by its holder's Role", async () => {
    dutyHolders.set("reviews", "cto");

    await expect(
      checks.newlyNamedRolesProblems({ roleKeys: [], dutyKeys: ["reviews"], projectId: undefined }),
    ).resolves.toEqual([CTO_ON_LOCAL]);
    await expect(
      checks.newlyNamedRolesProblems({
        roleKeys: [],
        dutyKeys: ["implements"],
        projectId: "admin-panel",
      }),
    ).resolves.toEqual([]);
  });

  it("lets through a duty nobody holds, which names no Role", async () => {
    await expect(
      checks.newlyNamedRolesProblems({ roleKeys: [], dutyKeys: ["plans"], projectId: undefined }),
    ).resolves.toEqual([]);
  });

  it("counts a duty a Pipeline names as its holder's Role on a save of a Project's levels", async () => {
    dutyHolders.set("reviews", "cto");
    dutyNamedByTheLibrary("reviews");

    // The Reviewer, whom the library names too, is put there with the Cto.
    await expect(check(aSave({}, { projectDefault: local }))).resolves.toEqual([
      expect.stringContaining("Cto"),
    ]);
  });

  it("refuses a duty change that puts a duty a Pipeline names on an incapable engine", async () => {
    dutyNamedByTheLibrary("implements");

    await expect(
      dutyChangeChecks.problemsOf({ duty: "implements", from: "developer", to: "cto" }),
    ).resolves.toEqual([CTO_ON_LOCAL]);
  });

  it("lets through a duty change no Pipeline is touched by, and leaving a duty unheld", async () => {
    dutyNamedByTheLibrary("implements");

    await expect(
      dutyChangeChecks.problemsOf({ duty: "reviews", from: "reviewer", to: "cto" }),
    ).resolves.toEqual([]);
    await expect(
      dutyChangeChecks.problemsOf({ duty: "implements", from: "developer", to: null }),
    ).resolves.toEqual([]);
  });
});
