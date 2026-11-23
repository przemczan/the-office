import { describe, expect, it } from "vitest";
import { FIRST_CLAUDE_CODE_ENGINE, type Engine } from "../../engine/index.js";
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
  changeProjectEngine,
  changeProjectLimit,
  changePublishingMode,
  changeRunEnvironment,
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
  ProjectDefaultPipelineChanged,
  ProjectEngineChanged,
  ProjectEnvironmentChanged,
  ProjectImageChanged,
  ProjectInstallCommandChanged,
  ProjectInstallInputsChanged,
  ProjectMarkChanged,
  ProjectPublishingModeChanged,
  ProjectRunEnvironmentChanged,
  ProjectSkillUseChanged,
  ProjectUseProjectSkillsChanged,
} from "./project-events.js";
import { aNewProject, aProject, startingCommands } from "./project.fixtures.js";
import type { ProjectEngine } from "./project.js";
import type { EngineTypeOffers } from "./project-engine.js";
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

const CLAUDE = { engineType: "claude-code", engineId: "claude-code" } as const;
const CODEX = { engineType: "codex", engineId: "codex" } as const;
/** Claude Code offers Sonnet and Opus at every effort, Codex gpt-5.5 at low to xhigh. */
const OFFERS: EngineTypeOffers = (type) =>
  type === "claude-code"
    ? {
        models: ["claude-sonnet-5-5", "claude-opus-5-5"],
        efforts: ["low", "medium", "high", "xhigh", "max"],
      }
    : { models: ["gpt-5.5"], efforts: ["low", "medium", "high", "xhigh"] };
const OPUS_ON_CLAUDE = {
  roleKey: "cto",
  engineSettings: { "claude-code": { model: "claude-opus-5-5", effort: "high" } },
} as const;

const NO_STAND_INS = { useOwnList: false, engineIds: [] };

function withEngine(engine: Partial<ProjectEngine>) {
  return aProject({
    engine: { default: null, force: null, people: [], standIns: NO_STAND_INS, ...engine },
  });
}

describe("changeProjectEngine", () => {
  it("replaces each level sent, keeps each left out, and announces the levels with one event", () => {
    const project = withEngine({ default: CLAUDE, people: [OPUS_ON_CLAUDE] });

    const change = changeProjectEngine(project, { force: { model: null, effort: "max" } }, OFFERS);

    expect(change?.project.engine).toEqual({
      default: CLAUDE,
      force: { model: null, effort: "max" },
      people: [OPUS_ON_CLAUDE],
      standIns: NO_STAND_INS,
    });
    expect(change?.event).toBeInstanceOf(ProjectEngineChanged);
    expect(change?.event).toMatchObject({
      projectId: "admin-panel",
      engine: change?.project.engine,
    });
  });

  it("changes nothing when every level sent already is so", () => {
    const project = withEngine({ default: CLAUDE, people: [OPUS_ON_CLAUDE] });

    expect(
      changeProjectEngine(project, { default: { ...CLAUDE }, people: [OPUS_ON_CLAUDE] }, OFFERS),
    ).toBeUndefined();
    expect(changeProjectEngine(project, {}, OFFERS)).toBeUndefined();
  });

  it("refuses a force without a default engine type", () => {
    expect(() =>
      changeProjectEngine(aProject(), { force: { model: null, effort: null } }, OFFERS),
    ).toThrow(new ProjectRefused(["Pick an engine type first."]));
    expect(() =>
      changeProjectEngine(
        withEngine({ default: CLAUDE }),
        { default: null, force: { model: "claude-opus-5-5", effort: null } },
        OFFERS,
      ),
    ).toThrow(new ProjectRefused(["Pick an engine type first."]));
  });

  it("clears the force with the default", () => {
    const forced = withEngine({
      default: CLAUDE,
      force: { model: "claude-opus-5-5", effort: null },
    });

    expect(changeProjectEngine(forced, { default: null }, OFFERS)?.project.engine).toEqual({
      default: null,
      force: null,
      people: [],
      standIns: NO_STAND_INS,
    });
  });

  it("keeps the force on through a change of type, with what the new type doesn't offer back to the engine's default", () => {
    const forced = withEngine({
      default: CLAUDE,
      force: { model: "claude-opus-5-5", effort: "max" },
    });

    expect(changeProjectEngine(forced, { default: CODEX }, OFFERS)?.project.engine.force).toEqual({
      model: null,
      effort: null,
    });
    const offered = withEngine({ default: CLAUDE, force: { model: null, effort: "high" } });
    expect(changeProjectEngine(offered, { default: CODEX }, OFFERS)?.project.engine.force).toEqual({
      model: null,
      effort: "high",
    });
  });

  it("refuses a person named twice or by no Role key", () => {
    expect(() =>
      changeProjectEngine(aProject(), { people: [OPUS_ON_CLAUDE, OPUS_ON_CLAUDE] }, OFFERS),
    ).toThrow(new ProjectRefused(['"cto" is named twice.']));
    expect(() =>
      changeProjectEngine(aProject(), { people: [{ ...OPUS_ON_CLAUDE, roleKey: " " }] }, OFFERS),
    ).toThrow(new ProjectRefused(["Each person's setting names its person."]));
  });

  it("doesn't keep a person with nothing set on any type", () => {
    const change = changeProjectEngine(
      aProject(),
      {
        people: [
          OPUS_ON_CLAUDE,
          { roleKey: "reviewer", engineSettings: { codex: { model: null, effort: null } } },
          { roleKey: "writer", engineSettings: {} },
        ],
      },
      OFFERS,
    );

    expect(change?.project.engine.people).toEqual([OPUS_ON_CLAUDE]);
  });

  it("replaces the Stand-in Engine list with the one sent, and keeps its engines when it is turned off", () => {
    const own = withEngine({ standIns: { useOwnList: true, engineIds: ["codex", "claude-code"] } });

    const turnedOff = changeProjectEngine(
      own,
      { standIns: { useOwnList: false, engineIds: ["codex", "claude-code"] } },
      OFFERS,
    );
    const reordered = changeProjectEngine(
      own,
      { standIns: { useOwnList: true, engineIds: ["claude-code", "codex"] } },
      OFFERS,
    );

    expect(turnedOff?.project.engine.standIns).toEqual({
      useOwnList: false,
      engineIds: ["codex", "claude-code"],
    });
    expect(turnedOff?.event).toBeInstanceOf(ProjectEngineChanged);
    expect(reordered?.project.engine.standIns.engineIds).toEqual(["claude-code", "codex"]);
    expect(changeProjectEngine(own, { default: null }, OFFERS)).toBeUndefined();
    expect(
      changeProjectEngine(
        own,
        { standIns: { useOwnList: true, engineIds: ["codex", "claude-code"] } },
        OFFERS,
      ),
    ).toBeUndefined();
  });
});

describe("moveEngineLevels", () => {
  const CODEX_ENGINE: Engine = {
    id: "codex",
    name: "Codex",
    kind: "codex",
    defaultModel: "gpt-5.5",
    defaultEffort: null,
    apiKey: null,
  };
  const SECOND_CLAUDE: Engine = { ...FIRST_CLAUDE_CODE_ENGINE, id: "second", name: "Second" };

  it("moves the Project default to the replacement, keeping the force on its type and the people", () => {
    const project = withEngine({
      default: CLAUDE,
      force: { model: "claude-opus-5-5", effort: "max" },
      people: [OPUS_ON_CLAUDE],
    });

    const { project: moved, events } = moveEngineLevels(project, {
      engineId: "claude-code",
      replacement: SECOND_CLAUDE,
    });

    expect(moved.engine).toEqual({
      default: { engineType: "claude-code", engineId: "second" },
      force: { model: "claude-opus-5-5", effort: "max" },
      people: [OPUS_ON_CLAUDE],
      standIns: NO_STAND_INS,
    });
    expect(events).toEqual([
      expect.objectContaining({ projectId: "admin-panel", engine: moved.engine }),
    ]);
  });

  it("gives the default the replacement's type, the forced model and effort it doesn't offer back to the engine's default", () => {
    const project = withEngine({
      default: CLAUDE,
      force: { model: "claude-opus-5-5", effort: "max" },
      people: [OPUS_ON_CLAUDE],
    });

    const { project: moved } = moveEngineLevels(project, {
      engineId: "claude-code",
      replacement: CODEX_ENGINE,
    });

    expect(moved.engine).toEqual({
      default: CODEX,
      force: { model: null, effort: null },
      people: [OPUS_ON_CLAUDE],
      standIns: NO_STAND_INS,
    });
  });

  it("clears the default and the force when the only engine goes, keeping the people", () => {
    const project = withEngine({
      default: CLAUDE,
      force: { model: null, effort: "high" },
      people: [OPUS_ON_CLAUDE],
    });

    const { project: moved, events } = moveEngineLevels(project, {
      engineId: "claude-code",
      replacement: null,
    });

    expect(moved.engine).toEqual({
      default: null,
      force: null,
      people: [OPUS_ON_CLAUDE],
      standIns: NO_STAND_INS,
    });
    expect(events).toHaveLength(1);
  });

  it("puts the replacement in the engine's place in the Project's own list, used or not", () => {
    for (const useOwnList of [true, false]) {
      const listed = withEngine({ standIns: { useOwnList, engineIds: ["claude-code", "codex"] } });
      const { project: moved, events } = moveEngineLevels(listed, {
        engineId: "claude-code",
        replacement: SECOND_CLAUDE,
      });

      expect(moved.engine.standIns).toEqual({ useOwnList, engineIds: ["second", "codex"] });
      expect(events).toHaveLength(1);
    }
  });

  it("drops the engine from a list already naming the replacement, or with none", () => {
    const project = withEngine({
      default: CODEX,
      standIns: { useOwnList: true, engineIds: ["claude-code", "codex"] },
    });

    expect(
      moveEngineLevels(project, { engineId: "claude-code", replacement: CODEX_ENGINE }).project
        .engine,
    ).toMatchObject({ default: CODEX, standIns: { useOwnList: true, engineIds: ["codex"] } });
    expect(
      moveEngineLevels(withEngine({ standIns: { useOwnList: true, engineIds: ["claude-code"] } }), {
        engineId: "claude-code",
        replacement: null,
      }).project.engine.standIns,
    ).toEqual({ useOwnList: true, engineIds: [] });
  });

  it("changes nothing when no level names the engine", () => {
    const project = withEngine({
      default: CODEX,
      people: [OPUS_ON_CLAUDE],
      standIns: { useOwnList: true, engineIds: ["codex"] },
    });

    expect(
      moveEngineLevels(project, { engineId: "claude-code", replacement: SECOND_CLAUDE }),
    ).toEqual({ project, events: [] });
  });
});
