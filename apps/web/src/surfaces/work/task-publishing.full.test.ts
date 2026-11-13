import { describe, expect, it } from "vitest";
import { taskPublishingWords } from "./task-publishing.ts";

const project = { publishingMode: "merge", baseBranch: "main" } as const;
const ORDINARY = { madeFor: null, projectId: "api" };

describe("taskPublishingWords", () => {
  it("names the Project's publishing mode for a Task of no Initiative", () => {
    expect(taskPublishingWords(ORDINARY, project, undefined)).toBe("merge into main");
    expect(
      taskPublishingWords(
        ORDINARY,
        { ...project, publishingMode: "push-and-pull-request" },
        undefined,
      ),
    ).toBe("push and open a pull request");
  });

  it("names the Project's publishing mode for a Task of an Initiative on None", () => {
    expect(taskPublishingWords(ORDINARY, project, { pipelines: [], shortName: null })).toBe(
      "merge into main",
    );
  });

  it("names the Project's publishing mode where the Initiative has None beside a Pipeline", () => {
    const initiative = {
      pipelines: [
        { projectId: "api", pipelineId: null },
        { projectId: "web", pipelineId: "full" },
      ],
      shortName: "dark-mode",
    };

    expect(taskPublishingWords(ORDINARY, project, initiative)).toBe("merge into main");
  });

  it("merges into the Initiative's branch whatever the publishing mode", () => {
    const initiative = {
      pipelines: [{ projectId: "api", pipelineId: "full" }],
      shortName: "dark-mode",
    };

    expect(
      taskPublishingWords(
        ORDINARY,
        { ...project, publishingMode: "push-and-pull-request" },
        initiative,
      ),
    ).toBe("merge into initiative/dark-mode");
  });

  it("puts the Initiative's branch itself into the base for its Publishing Task", () => {
    const initiative = {
      pipelines: [{ projectId: "api", pipelineId: "full" }],
      shortName: "dark-mode",
    };
    const publishing = { madeFor: "publishing", projectId: "api" } as const;

    expect(taskPublishingWords(publishing, project, initiative)).toBe(
      "puts initiative/dark-mode into main by one merge commit",
    );
    expect(
      taskPublishingWords(
        publishing,
        { ...project, publishingMode: "push-and-pull-request" },
        initiative,
      ),
    ).toBe("puts initiative/dark-mode into main by a pull request");
  });
});
