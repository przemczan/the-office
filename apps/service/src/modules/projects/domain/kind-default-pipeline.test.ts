import { describe, expect, it } from "vitest";
import { DEFAULT_ISSUE_SETTINGS } from "./issue-settings.js";
import { defaultPipelineFor, defaultPipelineOfKind } from "./kind-default-pipeline.js";
import { aProject } from "./project.fixtures.js";
import { changeIssueSettings, changeKindDefaultPipeline } from "./project-changes.js";

const ANN = { userId: "user-ann", name: "Ann" };
const BOB = { userId: "user-bob", name: "Bob" };

describe("defaultPipelineFor", () => {
  it("gives the Kind's own default Pipeline, else the Project's default", () => {
    const project = aProject({
      defaultPipeline: "full",
      kindDefaultPipelines: { feature: null, bug: "quick-fix", chore: null },
    });

    expect(defaultPipelineFor(project, "bug")).toBe("quick-fix");
    expect(defaultPipelineFor(project, "feature")).toBe("full");
    expect(defaultPipelineOfKind(project)).toEqual({
      feature: "full",
      bug: "quick-fix",
      chore: "full",
    });
  });

  it("changes one Kind's default, null following the Project's again", () => {
    const project = aProject({ defaultPipeline: "full" });

    const changed = changeKindDefaultPipeline(project, "bug", "quick-fix");
    expect(changed?.project.kindDefaultPipelines).toEqual({
      feature: null,
      bug: "quick-fix",
      chore: null,
    });
    expect(
      changeKindDefaultPipeline(changed?.project ?? project, "bug", "quick-fix"),
    ).toBeUndefined();
    expect(
      changeKindDefaultPipeline(changed?.project ?? project, "bug", null)?.project
        .kindDefaultPipelines.bug,
    ).toBeNull();
  });
});

describe("changeIssueSettings", () => {
  const SWITCHES = { closeOnDone: true, commentOnStartAndDone: false, closeOnDrop: false };

  it("records who set the label, keeps them while it stays, and forgets them with no label", () => {
    const project = aProject({ issueSettings: DEFAULT_ISSUE_SETTINGS });

    const set = changeIssueSettings(project, { ...SWITCHES, autoImportLabel: " office " }, ANN);
    expect(set?.project.issueSettings).toMatchObject({
      autoImportLabel: "office",
      autoImportLabelSetBy: ANN,
    });

    const switched = changeIssueSettings(
      set?.project ?? project,
      { ...SWITCHES, autoImportLabel: "office", closeOnDrop: true },
      BOB,
    );
    expect(switched?.project.issueSettings).toMatchObject({
      autoImportLabelSetBy: ANN,
      closeOnDrop: true,
    });

    const relabelled = changeIssueSettings(
      switched?.project ?? project,
      { ...SWITCHES, autoImportLabel: "triaged" },
      BOB,
    );
    expect(relabelled?.project.issueSettings.autoImportLabelSetBy).toEqual(BOB);

    const off = changeIssueSettings(
      relabelled?.project ?? project,
      { ...SWITCHES, autoImportLabel: null },
      ANN,
    );
    expect(off?.project.issueSettings).toMatchObject({
      autoImportLabel: null,
      autoImportLabelSetBy: null,
    });
    expect(
      changeIssueSettings(off?.project ?? project, { ...SWITCHES, autoImportLabel: null }, BOB),
    ).toBeUndefined();
  });
});
