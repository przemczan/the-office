import { describe, expect, it } from "vitest";
import { taskPublishingWords } from "./task-publishing.ts";

const project = { publishingMode: "merge", baseBranch: "main" } as const;

describe("taskPublishingWords", () => {
  it("names the Project's publishing mode for a Task of no Initiative", () => {
    expect(taskPublishingWords(project, undefined)).toBe("merge into main");
    expect(
      taskPublishingWords({ ...project, publishingMode: "push-and-pull-request" }, undefined),
    ).toBe("push and open a pull request");
  });

  it("names the Project's publishing mode for a Task of an Initiative on None", () => {
    expect(taskPublishingWords(project, { pipelineId: null, shortName: null })).toBe(
      "merge into main",
    );
  });

  it("merges into the Initiative's branch whatever the publishing mode", () => {
    const initiative = { pipelineId: "full", shortName: "dark-mode" };

    expect(
      taskPublishingWords({ ...project, publishingMode: "push-and-pull-request" }, initiative),
    ).toBe("merge into initiative/dark-mode");
  });
});
