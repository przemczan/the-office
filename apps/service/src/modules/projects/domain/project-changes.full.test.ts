import { describe, expect, it } from "vitest";
import {
  addCommand,
  addProject,
  changeCommand,
  changeCommandsAsProposed,
  changeInstallCommand,
  changeDefaultPipeline,
  changeEnvironment,
  changeInstallInputs,
  changeImage,
  changeMark,
  changeProjectDefault,
  changeProjectLimit,
  changePublishingMode,
  changeRoleOverride,
  changeRunEnvironment,
  changeUseForEveryRole,
  changeProjectSkillUse,
  changeUseProjectSkills,
  finishRunEnvironmentSetUp,
  moveEngineLevels,
  removeCommand,
} from "./project-changes.js";
import {
  ProjectAdded,
  ProjectCommandAdded,
  ProjectCommandChanged,
  ProjectCommandRemoved,
  ProjectDefaultChanged,
  ProjectDefaultPipelineChanged,
  ProjectEnvironmentChanged,
  ProjectImageChanged,
  ProjectInstallCommandChanged,
  ProjectInstallInputsChanged,
  ProjectMarkChanged,
  ProjectPublishingModeChanged,
  ProjectRoleOverrideChanged,
  ProjectRunEnvironmentChanged,
  ProjectUseForEveryRoleChanged,
  ProjectSkillUseChanged,
  ProjectUseProjectSkillsChanged,
} from "./project-events.js";
import { aNewProject, aProject, startingCommands } from "./project.fixtures.js";
import { ProjectRefused } from "./project-refused.js";
import type { ProposedCommands } from "./proposed-commands.js";

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

describe("changeInstallCommand", () => {
  it("changes install and announces it", () => {
    const change = changeInstallCommand(aProject(), " npm install ");

    expect(change?.project.installCommand).toBe("npm install");
    expect(change?.event).toBeInstanceOf(ProjectInstallCommandChanged);
    expect(change?.event).toMatchObject({ projectId: "admin-panel", commandLine: "npm install" });
  });

  it("changes nothing when install is already that line", () => {
    expect(changeInstallCommand(aProject(), "npm ci")).toBeUndefined();
  });

  it("refuses to clear install", () => {
    expect(() => changeInstallCommand(aProject(), " ")).toThrow(
      new ProjectRefused(["The install command can't be empty."]),
    );
  });
});

describe("addCommand", () => {
  const e2e = {
    key: "test-e2e",
    name: " End to end ",
    kind: "test",
    commandLine: " npm run e2e ",
    rerunCommandLine: "",
  } as const;

  it("adds the command after the others, trimmed, and announces it", () => {
    const { project, event } = addCommand(aProject(), e2e);

    const added = {
      key: "test-e2e",
      name: "End to end",
      kind: "test",
      commandLine: "npm run e2e",
      rerunCommandLine: "",
    } as const;
    expect(project.commands).toEqual([...aProject().commands, added]);
    expect(event).toBeInstanceOf(ProjectCommandAdded);
    expect(event).toMatchObject({ projectId: "admin-panel", command: added });
  });

  it("refuses a key the Project has, with a blank line, with every reason", () => {
    expect(() =>
      addCommand(aProject(), { ...e2e, key: "lint", commandLine: "", rerunCommandLine: "" }),
    ).toThrow(
      new ProjectRefused([
        'The Project already has a command with the key "lint".',
        "The lint command can't be empty.",
      ]),
    );
  });

  it.each(["install", "publish"])("refuses the key %j", (key) => {
    expect(() => addCommand(aProject(), { ...e2e, key })).toThrow(
      new ProjectRefused([`The key "${key}" is kept for The Office's own use.`]),
    );
  });
});

describe("changeCommand", () => {
  it("changes the name, kind and line of one command, keeping its key, and announces it", () => {
    const fields = {
      name: "Unit tests",
      kind: "test",
      commandLine: " npm test -- --run ",
      rerunCommandLine: "",
    } as const;

    const change = changeCommand(aProject(), "test", fields);

    const changed = {
      key: "test",
      name: "Unit tests",
      kind: "test",
      commandLine: "npm test -- --run",
      rerunCommandLine: "",
    } as const;
    expect(change?.project.commands).toEqual(
      startingCommands({ test: "npm test -- --run" }).map((command) =>
        command.key === "test" ? changed : command,
      ),
    );
    expect(change?.event).toBeInstanceOf(ProjectCommandChanged);
    expect(change?.event).toMatchObject({ projectId: "admin-panel", command: changed });
  });

  it("sets a test command's re-run command, trimmed, and clears it when given blank", () => {
    const test = { name: "Test", kind: "test", commandLine: "npm test" } as const;

    const set = changeCommand(aProject(), "test", {
      ...test,
      rerunCommandLine: " npm test -- --last-failed ",
    });
    const cleared = set && changeCommand(set.project, "test", { ...test, rerunCommandLine: " " });

    expect(set?.project.commands.find(({ key }) => key === "test")).toMatchObject({
      rerunCommandLine: "npm test -- --last-failed",
    });
    expect(cleared?.project.commands).toEqual(aProject().commands);
  });

  it("refuses a re-run command on a command not of kind test", () => {
    const fields = {
      name: "Build",
      kind: "build",
      commandLine: "npm run build",
      rerunCommandLine: "npm run build",
    } as const;

    expect(() => changeCommand(aProject(), "build", fields)).toThrow(
      new ProjectRefused(["Only a test command has a re-run command."]),
    );
  });

  it("changes nothing when the command already has them", () => {
    const fields = {
      name: "Lint",
      kind: "lint",
      commandLine: "npm run lint ",
      rerunCommandLine: "",
    } as const;

    expect(changeCommand(aProject(), "lint", fields)).toBeUndefined();
  });

  it("refuses an empty command", () => {
    const fields = {
      name: "Build",
      kind: "build",
      commandLine: "  ",
      rerunCommandLine: "",
    } as const;

    expect(() => changeCommand(aProject(), "build", fields)).toThrow(
      new ProjectRefused(["The build command can't be empty."]),
    );
  });

  it("refuses a key the Project has no command by", () => {
    const fields = {
      name: "E2E",
      kind: "test",
      commandLine: "npm run e2e",
      rerunCommandLine: "",
    } as const;

    expect(() => changeCommand(aProject(), "e2e", fields)).toThrow(
      new ProjectRefused(['The Project has no command with the key "e2e".']),
    );
  });
});

describe("removeCommand", () => {
  it("removes the command and announces it", () => {
    const { project, event } = removeCommand(aProject(), "lint");

    expect(project.commands.map(({ key }) => key)).toEqual(["build", "test"]);
    expect(event).toBeInstanceOf(ProjectCommandRemoved);
    expect(event).toMatchObject({ projectId: "admin-panel", key: "lint" });
  });

  it("refuses a key the Project has no command by", () => {
    expect(() => removeCommand(aProject(), "e2e")).toThrow(
      new ProjectRefused(['The Project has no command with the key "e2e".']),
    );
  });
});

describe("changeCommandsAsProposed", () => {
  const proposed: ProposedCommands = {
    installCommand: { from: "npm ci", to: "npm install" },
    installInputs: { from: ["package-lock.json"], to: ["package-lock.json", ".nvmrc"] },
    commands: [
      {
        key: "test",
        from: { name: "Test", kind: "test", commandLine: "npm test", rerunCommandLine: "" },
        to: { name: "Test", kind: "test", commandLine: "vitest run", rerunCommandLine: "" },
      },
      {
        key: "lint",
        from: { name: "Lint", kind: "lint", commandLine: "npm run lint", rerunCommandLine: "" },
        to: null,
      },
      {
        key: "test-e2e",
        from: null,
        to: { name: "End to end", kind: "test", commandLine: "npm run e2e", rerunCommandLine: "" },
      },
    ],
  };

  it("changes every field it proposes, each announced in turn", () => {
    const { project, events } = changeCommandsAsProposed(aProject(), proposed);

    expect(project.installCommand).toBe("npm install");
    expect(project.installInputs).toEqual(["package-lock.json", ".nvmrc"]);
    expect(project.commands).toEqual([
      {
        key: "build",
        name: "Build",
        kind: "build",
        commandLine: "npm run build",
        rerunCommandLine: "",
      },
      { key: "test", name: "Test", kind: "test", commandLine: "vitest run", rerunCommandLine: "" },
      {
        key: "test-e2e",
        name: "End to end",
        kind: "test",
        commandLine: "npm run e2e",
        rerunCommandLine: "",
      },
    ]);
    expect(events).toEqual([
      expect.any(ProjectInstallCommandChanged),
      expect.any(ProjectInstallInputsChanged),
      expect.any(ProjectCommandChanged),
      expect.any(ProjectCommandRemoved),
      expect.any(ProjectCommandAdded),
    ]);
  });

  it("refuses the whole Proposal when one field changed since it was drafted", () => {
    const editedByHand = aProject({ installInputs: ["pnpm-lock.yaml"] });

    expect(() => changeCommandsAsProposed(editedByHand, proposed)).toThrow(
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
  const environment = {
    set: [{ name: "CI", value: "1", secret: false }],
    unset: [],
    prependPath: ["/opt/bin"],
  };

  it("keeps the environment and announces it", () => {
    const change = changeEnvironment(aProject(), environment);

    expect(change?.project.environment).toEqual(environment);
    expect(change?.event).toBeInstanceOf(ProjectEnvironmentChanged);
    expect(change?.event).toMatchObject({ projectId: "admin-panel", environment });
  });

  it("announces a Secret variable by its name alone", () => {
    const withSecret = {
      ...environment,
      set: [...environment.set, { name: "NPM_TOKEN", value: "npm_s3cret", secret: true }],
    };

    const change = changeEnvironment(aProject(), withSecret);

    expect(change?.project.environment).toEqual(withSecret);
    expect(change?.event.environment.set).toEqual([
      { name: "CI", value: "1", secret: false },
      { name: "NPM_TOKEN", secret: true, valueSet: true },
    ]);
    expect(JSON.stringify(change?.event)).not.toContain("npm_s3cret");
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

describe("changeProjectLimit", () => {
  it("changes nothing when the Project already has that limit", () => {
    expect(changeProjectLimit(aProject({ projectLimit: 3 }), 3)).toBeUndefined();
  });
});

describe("changeRunEnvironment", () => {
  const NO_DEFINITION = ["The repository has no .devcontainer/devcontainer.json."];

  it("starts every Project at Not decided yet", () => {
    expect(addProject("admin-panel", aNewProject(), addedAt).project).toMatchObject({
      runEnvironment: "not-decided",
      runEnvironmentSetUpProblems: [],
    });
  });

  it("turns On with a valid definition, and changes nothing when it already is", () => {
    const change = changeRunEnvironment(aProject(), "on", []);

    expect(change?.project.runEnvironment).toBe("on");
    expect(change?.event).toEqual(
      expect.objectContaining({
        projectId: "admin-panel",
        runEnvironment: "on",
        setUpProblems: [],
      }),
    );
    expect(change?.event).toBeInstanceOf(ProjectRunEnvironmentChanged);
    expect(changeRunEnvironment(aProject({ runEnvironment: "on" }), "on", [])).toBeUndefined();
  });

  it("refuses On without a valid definition, with its problems as the reasons", () => {
    expect(() => changeRunEnvironment(aProject(), "on", NO_DEFINITION)).toThrow(
      new ProjectRefused([
        "Run environment can't be On: the base branch main has no valid .devcontainer/.",
        ...NO_DEFINITION,
      ]),
    );
  });

  it("always takes Off, and clears why the last set-up left it as it was", () => {
    const change = changeRunEnvironment(
      aProject({ runEnvironment: "off", runEnvironmentSetUpProblems: NO_DEFINITION }),
      "off",
      NO_DEFINITION,
    );

    expect(change?.project).toMatchObject({
      runEnvironment: "off",
      runEnvironmentSetUpProblems: [],
    });
  });
});

describe("finishRunEnvironmentSetUp", () => {
  it("turns On when the set-up Task's branch has a valid definition", () => {
    const change = finishRunEnvironmentSetUp(
      aProject({ runEnvironmentSetUpProblems: ["An earlier problem."] }),
      [],
    );

    expect(change?.project).toMatchObject({
      runEnvironment: "on",
      runEnvironmentSetUpProblems: [],
    });
  });

  it("leaves the setting as it was with an invalid one, keeping why", () => {
    const problems = ["devcontainer.json names no service."];
    const change = finishRunEnvironmentSetUp(aProject({ runEnvironment: "off" }), problems);

    expect(change?.project).toMatchObject({
      runEnvironment: "off",
      runEnvironmentSetUpProblems: problems,
    });
    expect(change?.event).toMatchObject({ runEnvironment: "off", setUpProblems: problems });
    expect(
      finishRunEnvironmentSetUp(
        aProject({ runEnvironment: "off", runEnvironmentSetUpProblems: problems }),
        problems,
      ),
    ).toBeUndefined();
  });
});

describe("changeImage", () => {
  const icon = { id: "first", mediaType: "image/png" } as const;
  const replacement = { id: "second", mediaType: "image/svg+xml" } as const;

  it("gives the Project the version, naming the image and its palette in the event", () => {
    const change = changeImage(aProject(), "icon", "dark", icon);

    expect(change?.project).toMatchObject({
      icon: { light: null, dark: icon },
      logo: { light: null, dark: null },
    });
    expect(change?.event).toBeInstanceOf(ProjectImageChanged);
    expect(change?.event).toMatchObject({
      projectId: "admin-panel",
      key: "icon",
      palette: "dark",
      image: icon,
    });
  });

  it("replaces one version and leaves the other version and the other image", () => {
    const both = { light: icon, dark: icon };
    const change = changeImage(aProject({ icon: both, logo: both }), "logo", "light", replacement);

    expect(change?.project).toMatchObject({ icon: both, logo: { light: replacement, dark: icon } });
  });

  it("removes the version", () => {
    const change = changeImage(
      aProject({ logo: { light: icon, dark: icon } }),
      "logo",
      "dark",
      null,
    );

    expect(change?.project.logo).toEqual({ light: icon, dark: null });
    expect(change?.event).toMatchObject({ key: "logo", palette: "dark", image: null });
  });

  it("changes nothing when there is no version to remove", () => {
    expect(
      changeImage(aProject({ icon: { light: icon, dark: null } }), "icon", "dark", null),
    ).toBeUndefined();
  });
});

describe("changeMark", () => {
  it("changes the label and colour together, announcing the new mark", () => {
    const change = changeMark(aProject(), { label: "FW1", colour: "ink" });

    expect(change?.project.mark).toEqual({ label: "FW1", colour: "ink" });
    expect(change?.event).toBeInstanceOf(ProjectMarkChanged);
    expect(change?.event).toMatchObject({
      projectId: "admin-panel",
      mark: { label: "FW1", colour: "ink" },
    });
  });

  it("keeps the label without its surrounding spaces", () => {
    const change = changeMark(aProject(), { label: " FW ", colour: "teal" });

    expect(change?.project.mark.label).toBe("FW");
  });

  it("changes when only the colour differs", () => {
    const change = changeMark(aProject(), { label: "AP", colour: "gray" });

    expect(change?.project.mark).toEqual({ label: "AP", colour: "gray" });
  });

  it.each(["", "ABCD", "A-"])("refuses the label %j", (label) => {
    expect(() => changeMark(aProject(), { label, colour: "teal" })).toThrow(
      new ProjectRefused(["The mark's label is 1 to 3 letters or digits."]),
    );
  });

  it("changes nothing when the label and colour are already those", () => {
    expect(changeMark(aProject(), { label: "AP", colour: "teal" })).toBeUndefined();
    expect(changeMark(aProject(), { label: " AP ", colour: "teal" })).toBeUndefined();
  });

  it("takes a custom colour, and changes nothing when it is the same", () => {
    const mark = { label: "AP", colour: "#3366cc" } as const;

    const change = changeMark(aProject(), mark);

    expect(change?.project.mark).toEqual(mark);
    expect(changeMark(aProject({ mark }), mark)).toBeUndefined();
  });

  it("refuses a colour that is neither named nor #rrggbb", () => {
    expect(() => changeMark(aProject(), { label: "AP", colour: "#ABCDEF" })).toThrow(
      "The mark's colour is a named colour or #rrggbb.",
    );
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
