import { describe, expect, it } from "vitest";
import {
  addProject,
  changeCommand,
  changeDefaultPipeline,
  changePublishingMode,
} from "./project-changes.js";
import {
  ProjectAdded,
  ProjectCommandChanged,
  ProjectDefaultPipelineChanged,
  ProjectPublishingModeChanged,
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
