import { describe, expect, it } from "vitest";
import { dispatchInputsOf } from "./workflow-dispatch.js";

describe("dispatchInputsOf", () => {
  it("reads the trigger as a string, a list or a map", () => {
    expect(dispatchInputsOf("on: workflow_dispatch\njobs: {}\n")).toEqual([]);
    expect(dispatchInputsOf("on: [push, workflow_dispatch]\n")).toEqual([]);
    expect(dispatchInputsOf("on:\n  push:\n  workflow_dispatch:\n")).toEqual([]);
  });

  it("reads each input of the five types, in its order", () => {
    const yaml = [
      "on:",
      "  workflow_dispatch:",
      "    inputs:",
      "      version:",
      "        description: The version to release",
      "        required: true",
      "      dry-run:",
      "        type: boolean",
      "        default: true",
      "      channel:",
      "        type: choice",
      "        options: [stable, beta]",
      "        default: beta",
      "      count:",
      "        type: number",
      "        default: 3",
      "      target:",
      "        type: environment",
    ].join("\n");

    expect(dispatchInputsOf(yaml)).toEqual([
      {
        name: "version",
        description: "The version to release",
        required: true,
        default: null,
        type: "string",
        options: [],
      },
      {
        name: "dry-run",
        description: "",
        required: false,
        default: "true",
        type: "boolean",
        options: [],
      },
      {
        name: "channel",
        description: "",
        required: false,
        default: "beta",
        type: "choice",
        options: ["stable", "beta"],
      },
      {
        name: "count",
        description: "",
        required: false,
        default: "3",
        type: "number",
        options: [],
      },
      {
        name: "target",
        description: "",
        required: false,
        default: null,
        type: "environment",
        options: [],
      },
    ]);
  });

  it("is not dispatchable for YAML it can't read or without the trigger", () => {
    expect(dispatchInputsOf("on: [push\njobs: {")).toBeUndefined();
    expect(dispatchInputsOf("on: push\n")).toBeUndefined();
  });

  it("keeps the key `on` as the string, not YAML 1.1's true", () => {
    expect(dispatchInputsOf("true: workflow_dispatch\n")).toBeUndefined();
    expect(dispatchInputsOf('"on": workflow_dispatch\n')).toEqual([]);
  });
});
