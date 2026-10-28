import { describe, expect, it } from "vitest";
import {
  addProject,
  changeCommand,
  changeCommandsAsProposed,
  changeDefaultPipeline,
  changeEnvironment,
  changeInstallInputs,
  changePublishingMode,
  changeUseProjectSkills,
} from "./project-changes.js";
import {
  ProjectAdded,
  ProjectCommandChanged,
  ProjectDefaultPipelineChanged,
  ProjectEnvironmentChanged,
  ProjectInstallInputsChanged,
  ProjectPublishingModeChanged,
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
