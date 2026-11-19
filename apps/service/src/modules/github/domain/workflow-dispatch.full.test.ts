import { describe, expect, it } from "vitest";
import { dispatchInputsOf } from "./workflow-dispatch.js";

/** The one input `name` declares as `body`, under a map trigger. */
function oneInput(body: string): string {
  return `on:\n  workflow_dispatch:\n    inputs:\n      name:\n${body}`;
}

describe("dispatchInputsOf", () => {
  it("reads a type it doesn't know as string", () => {
    expect(dispatchInputsOf(oneInput("        type: secret\n"))).toMatchObject([
      { name: "name", type: "string" },
    ]);
  });

  it("is not dispatchable for an `on` map without the trigger", () => {
    expect(dispatchInputsOf("on:\n  push:\n    branches: [main]\n")).toBeUndefined();
  });

  it("gives a choice without options none", () => {
    expect(dispatchInputsOf(oneInput("        type: choice\n"))).toMatchObject([
      { type: "choice", options: [] },
    ]);
  });

  it("gives a number default as a string", () => {
    expect(
      dispatchInputsOf(oneInput("        type: number\n        default: 2.5\n")),
    ).toMatchObject([{ default: "2.5" }]);
  });

  it("gives options only to a choice", () => {
    expect(dispatchInputsOf(oneInput("        options: [a, b]\n"))).toMatchObject([
      { type: "string", options: [] },
    ]);
  });

  it("reads an input declared without a body", () => {
    expect(dispatchInputsOf(oneInput(""))).toEqual([
      {
        name: "name",
        description: "",
        required: false,
        default: null,
        type: "string",
        options: [],
      },
    ]);
  });

  it("is not dispatchable for an empty file or a list of other triggers", () => {
    expect(dispatchInputsOf("")).toBeUndefined();
    expect(dispatchInputsOf("on: [push]\n")).toBeUndefined();
    expect(dispatchInputsOf("- on: workflow_dispatch\n")).toBeUndefined();
  });
});
