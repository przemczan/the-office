import { describe, expect, it } from "vitest";
import { commandProblem, newProjectProblems, projectIdFor } from "./project.js";
import { aNewProject } from "./project.fixtures.js";

describe("newProjectProblems", () => {
  it("passes a Project with a name, path, base branch, mark and four commands", () => {
    expect(newProjectProblems(aNewProject())).toEqual([]);
  });

  it("lists every missing field at once", () => {
    const blank = aNewProject({
      name: " ",
      path: "",
      baseBranch: "",
      mark: { label: "", colour: "violet" },
      commands: { install: "", build: "npm run build", lint: "npm run lint", test: " " },
    });

    expect(newProjectProblems(blank)).toEqual([
      "Give the Project a name.",
      "Give the path to the repository.",
      "Give the base branch.",
      "The mark's label is 1 to 3 letters or digits.",
      "The install command can't be empty.",
      "The test command can't be empty.",
    ]);
  });

  it("refuses a name longer than 60 characters", () => {
    expect(newProjectProblems(aNewProject({ name: "a".repeat(61) }))).toEqual([
      "A Project's name may be at most 60 characters.",
    ]);
  });

  it.each(["ABCD", "A B", "A-"])("refuses the mark label %j", (label) => {
    expect(newProjectProblems(aNewProject({ mark: { label, colour: "gray" } }))).toEqual([
      "The mark's label is 1 to 3 letters or digits.",
    ]);
  });

  it.each(["A", "TO", "Ż2", "FW1"])("takes the mark label %j", (label) => {
    expect(newProjectProblems(aNewProject({ mark: { label, colour: "ink" } }))).toEqual([]);
  });
});

describe("commandProblem", () => {
  it("takes one command line", () => {
    expect(commandProblem("test", "npm test -- --run")).toBeUndefined();
  });

  it("refuses more than one line", () => {
    expect(commandProblem("build", "npm ci\nnpm run build")).toBe(
      "The build command must be one line.",
    );
  });
});

describe("projectIdFor", () => {
  it("makes a short id of lowercase words from the name", () => {
    expect(projectIdFor("NotNullSoft Admin", new Set())).toBe("notnullsoft-admin");
    expect(projectIdFor("  Łódź · Café!  ", new Set())).toBe("odz-cafe");
  });

  it("keeps the id short enough for a worktree path", () => {
    expect(projectIdFor("A very long name for a small repository", new Set())).toBe(
      "a-very-long-name-for-a-s",
    );
  });

  it("numbers an id that is taken", () => {
    expect(projectIdFor("Admin", new Set(["admin", "admin-2"]))).toBe("admin-3");
  });

  it("falls back when the name has no letters or digits it can use", () => {
    expect(projectIdFor("···", new Set())).toBe("project");
  });
});
