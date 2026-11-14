import { describe, expect, it } from "vitest";
import { changeProjectLimit, changePublishingLine } from "./project-changes.js";
import {
  ProjectAfterPublishingCommandChanged,
  ProjectBeforePublishingCommandChanged,
  ProjectLimitChanged,
} from "./project-events.js";
import { PROJECT_LIMIT_MAX } from "./project.js";
import { aProject } from "./project.fixtures.js";
import { ProjectRefused } from "./project-refused.js";

describe("changeProjectLimit", () => {
  it("changes how many of the Project's Tasks may be started at once, and announces it", () => {
    const change = changeProjectLimit(aProject(), PROJECT_LIMIT_MAX);

    expect(change?.project.projectLimit).toBe(PROJECT_LIMIT_MAX);
    expect(change?.event).toBeInstanceOf(ProjectLimitChanged);
    expect(change?.event).toMatchObject({
      projectId: "admin-panel",
      projectLimit: PROJECT_LIMIT_MAX,
    });
  });

  it.each([0, PROJECT_LIMIT_MAX + 1, 1.5])("refuses %s with the reason", (projectLimit) => {
    expect(() => changeProjectLimit(aProject(), projectLimit)).toThrow(
      new ProjectRefused(["The Project limit is a whole number of Tasks from 1 to 12."]),
    );
  });
});

describe("changePublishingLine", () => {
  it("sets the before publishing line, trimmed, and announces it", () => {
    const change = changePublishingLine(
      aProject(),
      "beforePublishingCommand",
      " npx changeset version ",
    );

    expect(change?.project.beforePublishingCommand).toBe("npx changeset version");
    expect(change?.event).toBeInstanceOf(ProjectBeforePublishingCommandChanged);
    expect(change?.event).toMatchObject({
      projectId: "admin-panel",
      commandLine: "npx changeset version",
    });
  });

  it("clears the after publishing line when given blank, as blank runs nothing", () => {
    const change = changePublishingLine(
      aProject({ afterPublishingCommand: "gh workflow run release.yml" }),
      "afterPublishingCommand",
      "  ",
    );

    expect(change?.project.afterPublishingCommand).toBe("");
    expect(change?.event).toBeInstanceOf(ProjectAfterPublishingCommandChanged);
  });

  it("changes nothing when the line is already that, and refuses more than one line", () => {
    expect(changePublishingLine(aProject(), "afterPublishingCommand", "")).toBeUndefined();
    expect(() =>
      changePublishingLine(aProject(), "afterPublishingCommand", "npm run a\nnpm run b"),
    ).toThrow(new ProjectRefused(["The after publishing command must be one line."]));
  });
});
