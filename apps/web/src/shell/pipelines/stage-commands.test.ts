import type { ProjectCommand } from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import { ANOTHER_KEY, commandChoices, commandWords, namedCommands } from "./stage-commands.ts";

const test: ProjectCommand = { key: "test", name: "Test", kind: "test", commandLine: "npm test" };
const fullTests: ProjectCommand = {
  key: "test-full",
  name: "Full tests",
  kind: "test",
  commandLine: "npm run verify:full",
};

describe("commandChoices in the library", () => {
  const library = {
    kind: "library" as const,
    projects: [
      { name: "the-office", commands: [test, fullTests] },
      { name: "Site", commands: [test] },
    ],
  };

  it("suggests every key the Projects have, naming which have it, then Publish and another key", () => {
    expect(commandChoices("test", library)).toEqual([
      { value: "test", label: "test · Test (every Project)" },
      { value: "test-full", label: "test-full · Full tests (the-office)" },
      { value: "publish", label: "Publish" },
      { value: ANOTHER_KEY, label: "Another key…" },
    ]);
  });

  it("keeps a key no Project has listed, so the Stage doesn't change", () => {
    expect(commandChoices("e2e", library)[0]).toEqual({
      value: "e2e",
      label: "e2e · no Project has it",
    });
  });
});

describe("commandChoices in a Task's own editor", () => {
  const project = {
    kind: "project" as const,
    commands: [test, { ...fullTests, commandLine: "" }],
    publishing: "push and open a pull request",
  };

  it("offers the Project's commands by name and line, and Publish as it ships there", () => {
    expect(commandChoices("test", project)).toEqual([
      { value: "test", label: "Test · npm test" },
      { value: "test-full", label: "Full tests · not set" },
      { value: "publish", label: "Publish · push and open a pull request" },
    ]);
  });

  it("shows a key the Project lacks as not in this Project", () => {
    expect(commandChoices("e2e", project)[0]).toEqual({
      value: "e2e",
      label: "e2e · not in this Project",
    });
  });
});

describe("namedCommands", () => {
  it("names a library key by the first Project that has it, and a Task's by its Project", () => {
    const library = {
      kind: "library" as const,
      projects: [
        { name: "Site", commands: [test] },
        { name: "the-office", commands: [{ ...test, name: "Quick tests" }, fullTests] },
      ],
    };

    expect(commandWords("test", namedCommands(library))).toBe("Test");
    expect(commandWords("test-full", namedCommands(library))).toBe("Full tests");
    expect(namedCommands({ kind: "project", commands: [fullTests], publishing: "merge" })).toEqual([
      fullTests,
    ]);
  });
});

describe("commandWords", () => {
  it("reads Publish, the command's name when the Project is known, and the key otherwise", () => {
    expect(commandWords("publish")).toBe("Publish");
    expect(commandWords("test-full", [fullTests])).toBe("Full tests");
    expect(commandWords("test-full")).toBe("test-full");
  });
});
