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
} from "../../engine/index.js";
import type { ProjectCascadeLevels, ProjectWithCascadeLevels } from "../domain/engine-cascade.js";
import type { PipelineRolesNamed } from "../domain/pipeline-roles-named.js";
import { KnownProjectLevels } from "../ports/known-project-levels.js";
import { KnownWorkLevels } from "../ports/known-work-levels.js";
import { WorkLevelsForTests } from "../ports/known-work-levels.fixtures.js";
import { ProjectLevelsSaves, type ProjectLevelsSave } from "../ports/project-levels-saves.js";
import { PipelineRoleCapabilityChecks } from "./pipeline-role-capability-checks.js";
import { PipelineRoleSources } from "./pipeline-role-sources.js";
import { RoleCards } from "./role-cards.js";
import type { DutyKey } from "../domain/duties.js";
import type { RolesAndDuties } from "../domain/pipeline-roles-named.js";
import { Duties } from "./duties.js";
import { DutyChangeChecks } from "./duty-change-checks.js";

const officeDefault = { engineId: "claude-code", model: "claude-sonnet-5-5" };
const local = { engineId: "local", model: "gpt-oss" };
const engines: readonly Engine[] = [
  {
    id: "claude-code",
    name: "Claude Code",
    kind: "claude-code",
    defaultModel: "",
    defaultEffort: null,
    claudeCodeP: false,
  },
  {
    id: "local",
    name: "Local models",
    kind: "claude-code",
    defaultModel: "",
    defaultEffort: null,
    claudeCodeP: false,
  },
];
const codex: Engine = {
  id: "codex",
  name: "Codex",
  kind: "codex",
  defaultModel: "gpt-6-luna",
  defaultEffort: null,
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
let engineSettingsChecks: EngineSettingsChecks;
let checks: PipelineRoleCapabilityChecks;
/** The library names the Developer and the Reviewer; a test adds open Tasks' Roles by Project. */
let rolesNamed: PipelineRolesNamed;
/** Who holds each duty: the Developer Implements; a test sets others. */
let dutyHolders: Map<DutyKey, string>;
let dutyChangeChecks: DutyChangeChecks;
/** Tasks' and Initiatives' engines: none set until a test sets them. */
let workLevels: WorkLevelsForTests;
/** Whom each Task's Agent Stages name, as Pipelines would tell it: none until a test sets them. */
let namedByTasks: Map<string, RolesAndDuties>;

/** The CTO named by an open Task's own Stages in the Project, as Pipelines would tell it. */
function ctoNamedByATaskIn(projectId: string): void {
  rolesNamed = { ...rolesNamed, byProject: new Map([[projectId, new Set(["cto"])]]) };
}

beforeEach(async () => {
  const roleCards: Pick<RoleCards, "roleTitle"> = {
    roleTitle: (roleKey) => roleKey.charAt(0).toUpperCase() + roleKey.slice(1),
  };
  const engineModels: Pick<EngineModels, "engines" | "officeDefault"> = {
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
  workLevels = new WorkLevelsForTests();
  namedByTasks = new Map();
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
      { provide: KnownWorkLevels, useValue: workLevels },
      { provide: ProjectLevelsSaves, useValue: saves },
      EngineSettingsChecks,
      { provide: Duties, useValue: { holders: async () => dutyHolders } },
      DutyChangeChecks,
    ],
  }).compile();
  moduleRef.get(PipelineRoleSources).register(async () => rolesNamed);
  moduleRef.get(PipelineRoleSources).registerTaskSource(async (taskId) => namedByTasks.get(taskId));
  await moduleRef.init();
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
      "Local models can't use Office tools, which the Agent Stages of the Developer and the Reviewer need in Admin panel.",
    ]);
  });

  it("refuses a Project's Role override that puts a Role a Pipeline names on an incapable engine", async () => {
    await expect(
      check(aSave({}, { roleOverrides: [{ roleKey: "reviewer", ...local }] })),
    ).resolves.toEqual([
      "Local models can't use Office tools, which the Agent Stages of the Reviewer need in Admin panel.",
    ]);
  });

  it("lets through Use for every Role, which gives a model and never moves a session to another engine", async () => {
    await expect(
      check(
        aSave(
          { projectDefault: officeDefault },
          { projectDefault: officeDefault, useForEveryRole: true },
        ),
      ),
    ).resolves.toEqual([]);
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
      "Local models can't use Office tools, which the Agent Stages of the Cto need in Admin panel.",
    ]);
    ctoNamedByATaskIn("billing");
    await expect(check(aSave({}, ctoOnLocal))).resolves.toEqual([]);
  });
});

describe("PipelineRoleCapabilityChecks on a save of Settings › Engines", () => {
  const settings = { engines, officeDefault };

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
      "Local models can't use Office tools, which the Agent Stages of the Reviewer need in Shop.",
    ]);
  });

  it("refuses an Office default that puts the Roles a Pipeline names on an incapable engine", async () => {
    await expect(
      engineSettingsChecks.problemsOf({
        before: settings,
        after: { ...settings, officeDefault: local },
      }),
    ).resolves.toEqual([
      "Local models can't use Office tools, which the Agent Stages of the Developer and the Reviewer need outside any Project.",
      "Local models can't use Office tools, which the Agent Stages of the Developer and the Reviewer need in Billing.",
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
      "Workstation models can't use Office tools, which the Agent Stages of the Developer and the Reviewer need outside any Project.",
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
      "Local models can't use Office tools, which the Agent Stages of the Developer and the Reviewer need outside any Project.",
      "Local models can't use Office tools, which the Agent Stages of the Developer, the Reviewer, and the Cto need in Billing.",
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
  });

  it("lets through an Office default on a Gemini CLI engine, which lacks only what no Pipeline Role needs", async () => {
    const withGemini = { engines: [...engines, gemini], officeDefault };

    await expect(
      engineSettingsChecks.problemsOf({
        before: withGemini,
        after: { ...withGemini, officeDefault: onGemini },
      }),
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
      "Local models can't use Office tools, which the Agent Stages of the Cto need in Admin panel.",
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

  it("weighs a Project's Role override", async () => {
    moreProjects = [
      {
        projectId: "shop",
        projectName: "Shop",
        projectDefault: local,
        useForEveryRole: false,
        roleOverrides: [{ roleKey: "cto", ...officeDefault }],
      },
    ];

    await expect(
      checks.newlyNamedRolesProblems({ roleKeys: ["cto"], projectId: "shop" }),
    ).resolves.toEqual([]);
  });
});

describe("PipelineRoleCapabilityChecks on Stages naming a duty", () => {
  const CTO_ON_LOCAL =
    "Local models can't use Office tools, which the Agent Stages of the Cto need in Admin panel.";

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

    // The Developer and the Reviewer, whom the library names too, are put there with the Cto.
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

describe("PipelineRoleCapabilityChecks on a change of Tasks' engines", () => {
  const noEngine = { taskEngine: null, initiativeEngine: null };

  it("refuses a Task's engine that puts a Role its Stages name on an incapable engine, naming the Role", async () => {
    await expect(
      checks.workLevelsChangeProblems({
        place: "On “Fix the login”",
        tasks: [
          {
            projectId: "billing",
            roleKeys: ["reviewer"],
            dutyKeys: [],
            before: noEngine,
            after: { taskEngine: local, initiativeEngine: null },
          },
        ],
      }),
    ).resolves.toEqual([
      "On “Fix the login”, Local models can't use Office tools, which the Agent Stages of the Reviewer need.",
    ]);
  });

  it("lets through a Role with a Project's Role override of its own, and a Role already there", async () => {
    moreProjects = [
      {
        projectId: "shop",
        projectName: "Shop",
        projectDefault: null,
        useForEveryRole: false,
        roleOverrides: [{ roleKey: "developer", ...officeDefault }],
      },
    ];

    await expect(
      checks.workLevelsChangeProblems({
        place: "On “Fix the login”",
        tasks: [
          {
            projectId: "shop",
            roleKeys: ["developer"],
            dutyKeys: [],
            before: noEngine,
            after: { taskEngine: local, initiativeEngine: null },
          },
          {
            projectId: "admin-panel",
            roleKeys: ["reviewer"],
            dutyKeys: [],
            before: noEngine,
            after: { taskEngine: local, initiativeEngine: null },
          },
        ],
      }),
    ).resolves.toEqual([]);
  });

  it("weighs a duty by its holder, and names each Role once across the Initiative's Tasks, on each", async () => {
    dutyHolders.set("reviews", "cto");
    const move = {
      projectId: "billing",
      roleKeys: [],
      before: noEngine,
      after: { taskEngine: null, initiativeEngine: local },
    };

    await expect(
      checks.workLevelsChangeProblems({
        place: "In Payments",
        tasks: [
          { ...move, dutyKeys: ["reviews"], taskTitle: "Fix the login" },
          { ...move, roleKeys: ["cto"], dutyKeys: [], taskTitle: "Refund an order" },
        ],
      }),
    ).resolves.toEqual([
      "In Payments, Local models can't use Office tools, which the Agent Stages of the Cto need on “Fix the login” and “Refund an order”.",
    ]);
  });

  it("weighs a Pipeline chosen at the Task's engine by whom it newly names", async () => {
    const onLocal = { taskEngine: local, initiativeEngine: null };

    await expect(
      checks.workLevelsChangeProblems({
        place: "On “Fix the login”",
        tasks: [
          {
            projectId: "billing",
            roleKeys: ["reviewer", "cto"],
            dutyKeys: [],
            namedBefore: { roleKeys: ["reviewer"], dutyKeys: [] },
            before: onLocal,
            after: onLocal,
          },
        ],
      }),
    ).resolves.toEqual([
      "On “Fix the login”, Local models can't use Office tools, which the Agent Stages of the Cto need.",
    ]);
  });

  it("lets a Task's own engine win over an incapable Initiative's", async () => {
    await expect(
      checks.workLevelsChangeProblems({
        place: "In Payments",
        tasks: [
          {
            projectId: "billing",
            roleKeys: ["reviewer"],
            dutyKeys: [],
            before: { taskEngine: officeDefault, initiativeEngine: null },
            after: { taskEngine: officeDefault, initiativeEngine: local },
          },
        ],
      }),
    ).resolves.toEqual([]);
  });
});

/** A save of the Task "the-task"'s own Stages, from naming `before` to naming `after`. */
function save(after: readonly string[], before: readonly string[] = []) {
  return {
    taskId: "the-task",
    before: { roleKeys: before, dutyKeys: [] },
    after: { roleKeys: after, dutyKeys: [] },
  };
}

describe("PipelineRoleCapabilityChecks on a Task's own Stages while it sets an engine", () => {
  it("weighs the Roles the Stages newly name at the Task's engine", async () => {
    workLevels.setOpenTask("the-task", "billing", "Fix the login");
    workLevels.setForTask("the-task", local);

    await expect(
      checks.newlyNamedRolesProblems({
        roleKeys: [],
        projectId: "billing",
        task: save(["developer", "reviewer"], ["developer"]),
      }),
    ).resolves.toEqual([
      "On “Fix the login”, Local models can't use Office tools, which the Agent Stages of the Reviewer need.",
    ]);
  });

  it("weighs them at the Initiative's engine while the Task sets none", async () => {
    workLevels.setForInitiative("payments", local);
    workLevels.setInitiativeOf("the-task", "payments");

    await expect(
      checks.newlyNamedRolesProblems({ roleKeys: [], projectId: "billing", task: save(["cto"]) }),
    ).resolves.toHaveLength(1);
  });

  it("lets a capable Task engine through where the Project default is incapable", async () => {
    workLevels.setForTask("the-task", officeDefault);

    await expect(
      checks.newlyNamedRolesProblems({
        roleKeys: ["cto"],
        projectId: "admin-panel",
        task: save(["cto"]),
      }),
    ).resolves.toEqual([]);
  });

  it("weighs the Project's levels as before while neither sets an engine", async () => {
    await expect(
      checks.newlyNamedRolesProblems({
        roleKeys: ["cto"],
        projectId: "admin-panel",
        task: save(["cto"]),
      }),
    ).resolves.toHaveLength(1);
    await expect(
      checks.newlyNamedRolesProblems({
        roleKeys: [],
        projectId: "billing",
        task: save(["reviewer"]),
      }),
    ).resolves.toEqual([]);
  });
});

/** "Fix the login", open in `projectId` on Local models, whose Stages name the Developer. */
function aTaskOnLocalIn(projectId: string, named: Partial<RolesAndDuties> = {}): void {
  workLevels.setOpenTask("the-task", projectId, "Fix the login");
  workLevels.setForTask("the-task", local);
  namedByTasks.set("the-task", { roleKeys: ["developer"], dutyKeys: [], ...named });
}

describe("PipelineRoleCapabilityChecks on a save above a Task that sets an engine", () => {
  const TASK_CTO_ON_LOCAL =
    "On “Fix the login”, Local models can't use Office tools, which the Agent Stages of the Cto need.";
  const ADMIN_PANEL_CTO_ON_LOCAL =
    "Local models can't use Office tools, which the Agent Stages of the Cto need in Admin panel.";

  it("weighs the Initiative's engine while the Task sets none", async () => {
    workLevels.setOpenTask("the-task", "billing", "Fix the login");
    workLevels.setForInitiative("payments", local);
    workLevels.setInitiativeOf("the-task", "payments");
    namedByTasks.set("the-task", { roleKeys: [], dutyKeys: ["implements"] });
    dutyNamedByTheLibrary("implements");

    await expect(
      dutyChangeChecks.problemsOf({ duty: "implements", from: "developer", to: "cto" }),
    ).resolves.toContain(TASK_CTO_ON_LOCAL);
  });

  it("refuses a duty change that puts the duty the Task's Stages name on its engine", async () => {
    aTaskOnLocalIn("billing", { roleKeys: [], dutyKeys: ["implements"] });
    dutyNamedByTheLibrary("implements");

    await expect(
      dutyChangeChecks.problemsOf({ duty: "implements", from: "developer", to: "cto" }),
    ).resolves.toEqual([ADMIN_PANEL_CTO_ON_LOCAL, TASK_CTO_ON_LOCAL]);
  });

  it("weighs a Role a Pipeline newly names at the Task's engine, whichever Pipeline it follows", async () => {
    aTaskOnLocalIn("billing");

    await expect(
      checks.newlyNamedRolesProblems({ roleKeys: ["cto"], projectId: undefined }),
    ).resolves.toEqual([ADMIN_PANEL_CTO_ON_LOCAL, TASK_CTO_ON_LOCAL]);
  });

  it("lets through a save that leaves the Task's sessions where they are", async () => {
    aTaskOnLocalIn("billing", { roleKeys: ["reviewer"] });

    // The Reviewer already runs on the Task's engine; the Office default doesn't reach the Task.
    await expect(
      engineSettingsChecks.problemsOf({
        before: { engines, officeDefault },
        after: { engines, officeDefault: { ...officeDefault, model: "claude-haiku-5-5" } },
      }),
    ).resolves.toEqual([]);
  });

  it("leaves the Task's engine a removal moves to Work's own check", async () => {
    aTaskOnLocalIn("billing", { roleKeys: ["reviewer"] });
    const [claudeCode, localModels] = engines;

    const problems = await engineSettingsChecks.problemsOf({
      before: { engines, officeDefault },
      after: { engines: [claudeCode!], officeDefault },
      removal: { engineId: localModels!.id, replacement: claudeCode! },
    });

    expect(problems).toEqual([]);
  });

  it("skips a Task in a Project the save leaves alone", async () => {
    aTaskOnLocalIn("billing");

    await expect(
      check(aSave({}, { roleOverrides: [{ roleKey: "developer", ...local }] })),
    ).resolves.toEqual([
      "Local models can't use Office tools, which the Agent Stages of the Developer need in Admin panel.",
    ]);
  });
});
