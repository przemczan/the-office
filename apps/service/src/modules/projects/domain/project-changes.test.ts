import { describe, expect, it } from "vitest";
import {
  addProject,
  changeCommand,
  changeCommandsAsProposed,
  changeDefaultPipeline,
  changeEnvironment,
  changeInstallInputs,
  changeProjectDefault,
  changePublishingMode,
  changeRoleOverride,
  changeUseForEveryRole,
  changeProjectSkillUse,
  changeUseProjectSkills,
  moveEngineLevels,
} from "./project-changes.js";
import {
  ProjectAdded,
  ProjectCommandChanged,
  ProjectDefaultChanged,
  ProjectDefaultPipelineChanged,
  ProjectEnvironmentChanged,
  ProjectInstallInputsChanged,
  ProjectPublishingModeChanged,
  ProjectRoleOverrideChanged,
  ProjectUseForEveryRoleChanged,
  ProjectSkillUseChanged,
  ProjectUseProjectSkillsChanged,
} from "./project-events.js";
import { aNewProject, aProject } from "./project.fixtures.js";
import { ProjectRefused } from "./project-refused.js";

const addedAt = new Date("2026-10-25T10:00:00.000Z");

describe("addProject", () => {
  it("keeps what the user typed without its surrounding spaces, with the skills switch on", () => {
    const { project, event } = addProject(
      "admin-panel",
      aNewProject({ name: " Admin panel ", baseBranch: " main" }),
      addedAt,
    );

    expect(project).toEqual(aProject({ addedAt }));
    expect(event).toEqual(new ProjectAdded(project));
    expect(event.occurredAt).toEqual(addedAt);
  });

  it("refuses with every reason", () => {
    expect(() => addProject("x", aNewProject({ name: "", baseBranch: "" }), addedAt)).toThrow(
      new ProjectRefused(["Give the Project a name.", "Give the base branch."]),
    );
  });
});

describe("changeCommand", () => {
  it("changes one command and announces it", () => {
    const change = changeCommand(aProject(), "test", " npm test -- --run ");

    expect(change?.project.commands).toEqual({ ...aProject().commands, test: "npm test -- --run" });
    expect(change?.event).toBeInstanceOf(ProjectCommandChanged);
    expect(change?.event).toMatchObject({
      projectId: "admin-panel",
      key: "test",
      commandLine: "npm test -- --run",
    });
  });

  it("changes nothing when the command is already that line", () => {
    expect(changeCommand(aProject(), "lint", "npm run lint ")).toBeUndefined();
  });

  it("refuses an empty command", () => {
    expect(() => changeCommand(aProject(), "build", "  ")).toThrow(
      new ProjectRefused(["The build command can't be empty."]),
    );
  });
});

describe("changeCommandsAsProposed", () => {
  const from = { test: "npm test", installInputs: ["package-lock.json"] };
  const to = { test: "vitest run", installInputs: ["package-lock.json", ".nvmrc"] };

  it("changes every field it proposes, each announced in turn", () => {
    const { project, events } = changeCommandsAsProposed(aProject(), from, to);

    expect(project.commands.test).toBe("vitest run");
    expect(project.installInputs).toEqual(["package-lock.json", ".nvmrc"]);
    expect(events).toEqual([
      expect.any(ProjectCommandChanged),
      expect.any(ProjectInstallInputsChanged),
    ]);
  });

  it("refuses the whole Proposal when one field changed since it was drafted", () => {
    const editedByHand = aProject({ installInputs: ["pnpm-lock.yaml"] });

    expect(() => changeCommandsAsProposed(editedByHand, from, to)).toThrow(
      new ProjectRefused(["The install inputs changed since this was proposed."]),
    );
  });
});

describe("changeInstallInputs", () => {
  it("keeps the install inputs as given, trimmed, and announces them", () => {
    const change = changeInstallInputs(aProject(), [
      " package-lock.json",
      "apps\\web\\package.json",
    ]);

    expect(change?.project.installInputs).toEqual(["package-lock.json", "apps/web/package.json"]);
    expect(change?.event).toBeInstanceOf(ProjectInstallInputsChanged);
    expect(change?.event).toMatchObject({
      projectId: "admin-panel",
      installInputs: ["package-lock.json", "apps/web/package.json"],
    });
  });

  it("changes nothing when the install inputs are already those", () => {
    expect(changeInstallInputs(aProject(), ["./package-lock.json", ""])).toBeUndefined();
  });

  it("takes none", () => {
    expect(changeInstallInputs(aProject(), [])?.project.installInputs).toEqual([]);
  });

  it("refuses a path outside the repository", () => {
    expect(() => changeInstallInputs(aProject(), ["../package-lock.json"])).toThrow(
      new ProjectRefused([
        'An install input is a path inside the repository; "../package-lock.json" is not.',
      ]),
    );
  });
});

describe("changeEnvironment", () => {
  const environment = { set: [{ name: "CI", value: "1" }], unset: [], prependPath: ["/opt/bin"] };

  it("keeps the environment and announces it", () => {
    const change = changeEnvironment(aProject(), environment);

    expect(change?.project.environment).toEqual(environment);
    expect(change?.event).toBeInstanceOf(ProjectEnvironmentChanged);
    expect(change?.event).toMatchObject({ projectId: "admin-panel", environment });
  });

  it("changes nothing when the Project already has that environment", () => {
    expect(changeEnvironment(aProject({ environment }), { ...environment })).toBeUndefined();
  });
});

describe("changePublishingMode", () => {
  it("changes how the Project publishes, and changes nothing when it already does", () => {
    const change = changePublishingMode(aProject(), "merge");

    expect(change?.project.publishingMode).toBe("merge");
    expect(change?.event).toBeInstanceOf(ProjectPublishingModeChanged);
    expect(change?.event).toMatchObject({ projectId: "admin-panel", publishingMode: "merge" });
    expect(changePublishingMode(aProject(), "push-and-pull-request")).toBeUndefined();
  });
});

describe("changeDefaultPipeline", () => {
  it("changes the default, and changes nothing when it already is", () => {
    const change = changeDefaultPipeline(aProject(), "quick-fix");

    expect(change?.project.defaultPipeline).toBe("quick-fix");
    expect(change?.event).toBeInstanceOf(ProjectDefaultPipelineChanged);
    expect(change?.event).toMatchObject({ projectId: "admin-panel", defaultPipeline: "quick-fix" });
    expect(changeDefaultPipeline(aProject(), "full")).toBeUndefined();
  });
});

describe("changeUseProjectSkills", () => {
  it("switches the Project's own skills off and on, and changes nothing when it already is", () => {
    const change = changeUseProjectSkills(aProject(), false);

    expect(change?.project.useProjectSkills).toBe(false);
    expect(change?.event).toBeInstanceOf(ProjectUseProjectSkillsChanged);
    expect(change?.event).toMatchObject({ projectId: "admin-panel", useProjectSkills: false });
    expect(changeUseProjectSkills(aProject(), true)).toBeUndefined();
  });
});

describe("changeProjectSkillUse", () => {
  it("turns one skill off and leaves the others as they were", () => {
    const change = changeProjectSkillUse(aProject({ projectSkillsOff: ["ship"] }), "deploy", false);

    expect(change?.project.projectSkillsOff).toEqual(["ship", "deploy"]);
    expect(change?.event).toBeInstanceOf(ProjectSkillUseChanged);
    expect(change?.event).toMatchObject({
      projectId: "admin-panel",
      key: "deploy",
      use: false,
    });
  });

  it("turns one skill back on", () => {
    const change = changeProjectSkillUse(
      aProject({ projectSkillsOff: ["ship", "deploy"] }),
      "deploy",
      true,
    );

    expect(change?.project.projectSkillsOff).toEqual(["ship"]);
    expect(change?.event).toMatchObject({ key: "deploy", use: true });
  });

  it("changes nothing when the skill already is that way", () => {
    expect(changeProjectSkillUse(aProject(), "deploy", true)).toBeUndefined();
    expect(
      changeProjectSkillUse(aProject({ projectSkillsOff: ["deploy"] }), "deploy", false),
    ).toBeUndefined();
  });

  it("keeps each skill's setting while the Project uses none of them", () => {
    const off = changeUseProjectSkills(aProject({ projectSkillsOff: ["deploy"] }), false);
    const backOn = off && changeUseProjectSkills(off.project, true);

    expect(backOn?.project.projectSkillsOff).toEqual(["deploy"]);
  });
});

const SONNET = { engineId: "claude-code", model: "claude-sonnet-5-5" };
const HAIKU = { engineId: "claude-code", model: "claude-haiku-5-5" };

describe("changeProjectDefault", () => {
  it("sets the Project default, clears it, and changes nothing when it already is", () => {
    const change = changeProjectDefault(aProject(), SONNET);

    expect(change?.project.projectDefault).toEqual(SONNET);
    expect(change?.event).toBeInstanceOf(ProjectDefaultChanged);
    expect(change?.event).toMatchObject({ projectId: "admin-panel", projectDefault: SONNET });
    expect(
      changeProjectDefault(aProject({ projectDefault: SONNET }), { ...SONNET }),
    ).toBeUndefined();
    expect(changeProjectDefault(aProject({ projectDefault: SONNET }), null)?.project).toEqual(
      aProject(),
    );
    expect(changeProjectDefault(aProject(), null)).toBeUndefined();
  });

  it("refuses to clear the default while it is used for every Role", () => {
    const forced = aProject({ projectDefault: SONNET, useForEveryRole: true });

    expect(() => changeProjectDefault(forced, null)).toThrow(
      new ProjectRefused([
        'Turn off "Use for every Role" before leaving the Project without a default.',
      ]),
    );
    expect(changeProjectDefault(forced, HAIKU)?.project.projectDefault).toEqual(HAIKU);
  });
});

describe("changeUseForEveryRole", () => {
  it("forces the Project default on every Role, and changes nothing when it already is", () => {
    const change = changeUseForEveryRole(aProject({ projectDefault: SONNET }), true);

    expect(change?.project.useForEveryRole).toBe(true);
    expect(change?.event).toBeInstanceOf(ProjectUseForEveryRoleChanged);
    expect(change?.event).toMatchObject({ projectId: "admin-panel", useForEveryRole: true });
    expect(changeUseForEveryRole(aProject(), false)).toBeUndefined();
  });

  it("refuses it without a Project default", () => {
    expect(() => changeUseForEveryRole(aProject(), true)).toThrow(
      new ProjectRefused(["Choose a Project default before using it for every Role."]),
    );
  });
});

describe("moveEngineLevels", () => {
  const LOCAL = { engineId: "local", model: "gpt-oss" };
  const toLocal = (reference: typeof SONNET) =>
    reference.engineId === "claude-code" ? LOCAL : reference;

  it("moves the Project default and each Role override naming the engine, each with its event", () => {
    const project = aProject({
      projectDefault: SONNET,
      useForEveryRole: true,
      roleOverrides: [
        { roleKey: "cto", ...HAIKU },
        { roleKey: "reviewer", engineId: "other", model: "m" },
      ],
    });

    const { project: moved, events } = moveEngineLevels(project, toLocal);

    expect(moved).toEqual({
      ...project,
      projectDefault: LOCAL,
      roleOverrides: [
        { roleKey: "cto", ...LOCAL },
        { roleKey: "reviewer", engineId: "other", model: "m" },
      ],
    });
    expect(events.map((event) => event.constructor)).toEqual([
      ProjectDefaultChanged,
      ProjectRoleOverrideChanged,
    ]);
    expect(events).toEqual([
      expect.objectContaining({ projectId: "admin-panel", projectDefault: LOCAL }),
      expect.objectContaining({ projectId: "admin-panel", roleKey: "cto", roleOverride: LOCAL }),
    ]);
  });

  it("moves every level to none when the only engine goes, turning off the force first", () => {
    const project = aProject({
      projectDefault: SONNET,
      useForEveryRole: true,
      roleOverrides: [{ roleKey: "cto", ...HAIKU }],
    });

    const { project: moved, events } = moveEngineLevels(project, () => null);

    expect(moved).toEqual({
      ...project,
      projectDefault: null,
      useForEveryRole: false,
      roleOverrides: [],
    });
    expect(events.map((event) => event.constructor)).toEqual([
      ProjectUseForEveryRoleChanged,
      ProjectDefaultChanged,
      ProjectRoleOverrideChanged,
    ]);
  });

  it("changes nothing when nothing names the engine", () => {
    const project = aProject({ roleOverrides: [{ roleKey: "cto", ...LOCAL }] });

    expect(moveEngineLevels(project, toLocal)).toEqual({ project, events: [] });
  });
});

describe("changeRoleOverride", () => {
  it("adds a Role's override, replaces it in place, and removes it", () => {
    const added = changeRoleOverride(aProject(), "cto", SONNET);
    expect(added?.project.roleOverrides).toEqual([{ roleKey: "cto", ...SONNET }]);
    expect(added?.event).toBeInstanceOf(ProjectRoleOverrideChanged);
    expect(added?.event).toMatchObject({
      projectId: "admin-panel",
      roleKey: "cto",
      roleOverride: SONNET,
    });

    const two = aProject({
      roleOverrides: [
        { roleKey: "cto", ...SONNET },
        { roleKey: "reviewer", ...SONNET },
      ],
    });
    expect(changeRoleOverride(two, "cto", HAIKU)?.project.roleOverrides).toEqual([
      { roleKey: "cto", ...HAIKU },
      { roleKey: "reviewer", ...SONNET },
    ]);

    const removed = changeRoleOverride(two, "cto", null);
    expect(removed?.project.roleOverrides).toEqual([{ roleKey: "reviewer", ...SONNET }]);
    expect(removed?.event).toBeInstanceOf(ProjectRoleOverrideChanged);
    expect(removed?.event).toMatchObject({
      projectId: "admin-panel",
      roleKey: "cto",
      roleOverride: null,
    });
  });

  it("changes nothing when the override already is so", () => {
    const project = aProject({ roleOverrides: [{ roleKey: "cto", ...SONNET }] });

    expect(changeRoleOverride(project, "cto", { ...SONNET })).toBeUndefined();
    expect(changeRoleOverride(project, "reviewer", null)).toBeUndefined();
  });

  it("refuses an override that names no Role", () => {
    expect(() => changeRoleOverride(aProject(), " ", SONNET)).toThrow(
      new ProjectRefused(["A Role override names its Role."]),
    );
  });
});
