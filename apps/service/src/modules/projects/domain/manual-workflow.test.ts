import { describe, expect, it } from "vitest";
import { inputsToSend, type ManualWorkflow, type WorkflowInput } from "./manual-workflow.js";
import { ProjectRefused } from "./project-refused.js";

function anInput(name: string, given: Partial<WorkflowInput> = {}): WorkflowInput {
  return {
    name,
    description: "",
    required: false,
    default: null,
    kind: "text",
    options: [],
    ...given,
  };
}

const RELEASE: ManualWorkflow = {
  id: "release.yml",
  name: "Release",
  url: "https://github.com/office/tools/actions/workflows/release.yml",
  inputs: [
    anInput("channel", { kind: "choice", required: true, options: ["beta", "stable"] }),
    anInput("dry-run", { kind: "yes-no", default: "false" }),
    anInput("shards", { kind: "number", default: "2" }),
    anInput("notes"),
    anInput("target", { kind: "environment" }),
  ],
};

/** The reasons `inputsToSend` refuses with. */
function refusalOf(given: Record<string, string>): readonly string[] {
  try {
    inputsToSend(RELEASE, given);
  } catch (error) {
    if (error instanceof ProjectRefused) return error.reasons;
    throw error;
  }
  throw new Error("Not refused.");
}

describe("a Workflow's inputs started by hand", () => {
  it("sends the given ones and the defaults of the rest, leaving out one with neither", () => {
    expect(inputsToSend(RELEASE, { channel: "beta", shards: "4", target: "" })).toEqual({
      channel: "beta",
      "dry-run": "false",
      shards: "4",
    });
  });

  it("takes an empty value as none, so the default fills it", () => {
    expect(inputsToSend(RELEASE, { channel: "stable", "dry-run": "" })).toEqual({
      channel: "stable",
      "dry-run": "false",
      shards: "2",
    });
  });

  it("refuses with every reason in plain words", () => {
    expect(refusalOf({ "dry-run": "maybe", shards: "many", flavour: "mint" })).toEqual([
      "release.yml has no input named flavour.",
      "release.yml needs a value for channel.",
      `release.yml's dry-run is "maybe", but a yes-no is true or false.`,
      `release.yml's shards is "many", which isn't a number.`,
    ]);
  });

  it("refuses a required input left empty, and a choice outside its options, naming them", () => {
    expect(refusalOf({ channel: "" })).toEqual(["release.yml needs a value for channel."]);
    expect(refusalOf({ channel: "nightly" })).toEqual([
      `release.yml's channel is "nightly", not one of its options: beta, stable.`,
    ]);
  });
});
