import { describe, expect, it } from "vitest";
import { changeProjectLimit } from "./project-changes.js";
import { ProjectLimitChanged } from "./project-events.js";
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
