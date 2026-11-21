import { describe, expect, it } from "vitest";
import {
  commandFieldsProblems,
  commandKeyProblems,
  commandProblem,
  installInputsProblems,
  newProjectProblems,
  projectIdFor,
  trimmedInstallInputs,
  type ProjectMarkColour,
} from "./project.js";
import { aNewProject, startingCommands } from "./project.fixtures.js";

describe("newProjectProblems", () => {
  it("passes a Project with a name, path, base branch, mark, install and three commands", () => {
    expect(newProjectProblems(aNewProject())).toEqual([]);
  });

  it("lists every missing field at once", () => {
    const blank = aNewProject({
      name: " ",
      path: "",
      baseBranch: "",
      mark: { label: "", colour: "violet" },
    });

    expect(newProjectProblems(blank)).toEqual([
      "Give the Project a name.",
      "Give the path to the repository.",
      "Give the base branch.",
      "The mark's label is 1 to 3 letters or digits.",
    ]);
  });

  it("passes a Project whose commands are left blank, as they can be set later", () => {
    const commands = startingCommands({ build: " ", lint: "", test: "" });

    expect(newProjectProblems(aNewProject({ installCommand: "", commands }))).toEqual([]);
  });

  it("refuses a command given in more than one line", () => {
    const commands = startingCommands({ build: "npm ci\nnpm run build" });

    expect(newProjectProblems(aNewProject({ commands }))).toEqual([
      "The build command must be one line.",
    ]);
  });

  it("refuses an install command given in more than one line", () => {
    expect(newProjectProblems(aNewProject({ installCommand: "npm ci\nnpm ci" }))).toEqual([
      "The install command must be one line.",
    ]);
  });

  it("refuses two commands with one key", () => {
    const [build] = startingCommands();
    const commands = [...startingCommands(), { ...build!, name: "Build again" }];

    expect(newProjectProblems(aNewProject({ commands }))).toEqual([
      'The Project already has a command with the key "build".',
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

  it("takes a custom mark colour", () => {
    const mark = { label: "AP", colour: "#3366cc" } as const;

    expect(newProjectProblems(aNewProject({ mark }))).toEqual([]);
  });

  it.each(["pink", "#12", "#ABCDEF", "#3366cc "])("refuses the mark colour %j", (colour) => {
    const mark = { label: "AP", colour: colour as ProjectMarkColour };

    expect(newProjectProblems(aNewProject({ mark }))).toEqual([
      "The mark's colour is a named colour or #rrggbb.",
    ]);
  });
});

describe("commandKeyProblems", () => {
  it.each(["test-full", "e2e", "a", "build-2"])("takes the key %j", (key) => {
    expect(commandKeyProblems(key, startingCommands())).toEqual([]);
  });

  it.each(["Test", "2e", "-a", "test_full", "test full", ""])("refuses the key %j", (key) => {
    expect(commandKeyProblems(key, [])).toEqual([
      `A command's key is lower-case letters, digits and "-", starting with a letter; "${key}" is not.`,
    ]);
  });

  it("refuses a key longer than 40 characters", () => {
    expect(commandKeyProblems("a".repeat(41), [])).toEqual([
      "A command's key may be at most 40 characters.",
    ]);
  });

  it.each(["install", "publish"])("keeps %j for The Office", (key) => {
    expect(commandKeyProblems(key, [])).toEqual([
      `The key "${key}" is kept for The Office's own use.`,
    ]);
  });

  it("refuses a key the Project already has", () => {
    expect(commandKeyProblems("lint", startingCommands())).toEqual([
      'The Project already has a command with the key "lint".',
    ]);
  });
});

describe("commandFieldsProblems", () => {
  const command = {
    key: "e2e",
    name: "End to end",
    kind: "test",
    commandLine: "npm run e2e",
    rerunCommandLine: "",
  } as const;

  it("takes a command with a name, a kind and one line", () => {
    expect(commandFieldsProblems(command, { blankAllowed: false })).toEqual([]);
  });

  it("refuses a blank name and a blank line once added", () => {
    expect(
      commandFieldsProblems({ ...command, name: " ", commandLine: "" }, { blankAllowed: false }),
    ).toEqual(["Give the e2e command a name.", "The e2e command can't be empty."]);
  });

  it("takes a blank line while the Project is added", () => {
    expect(commandFieldsProblems({ ...command, commandLine: "" }, { blankAllowed: true })).toEqual(
      [],
    );
  });

  it("refuses a name longer than 60 characters", () => {
    expect(
      commandFieldsProblems({ ...command, name: "a".repeat(61) }, { blankAllowed: false }),
    ).toEqual(["A command's name may be at most 60 characters."]);
  });

  it("takes a re-run command of one line on a test command", () => {
    const rerunCommandLine = "npm run e2e -- --last-failed";
    expect(
      commandFieldsProblems({ ...command, rerunCommandLine }, { blankAllowed: false }),
    ).toEqual([]);
  });

  it("refuses a re-run command of more than one line", () => {
    expect(
      commandFieldsProblems(
        { ...command, rerunCommandLine: "npm run e2e\nnpm run e2e" },
        { blankAllowed: false },
      ),
    ).toEqual(["The e2e command's re-run command must be one line."]);
  });

  it("refuses a re-run command on a command not of kind test, and takes a blank one there", () => {
    const build = { ...command, kind: "build" } as const;
    expect(
      commandFieldsProblems(
        { ...build, rerunCommandLine: "npm run build" },
        { blankAllowed: false },
      ),
    ).toEqual(["Only a test command has a re-run command."]);
    expect(
      commandFieldsProblems({ ...build, rerunCommandLine: " " }, { blankAllowed: false }),
    ).toEqual([]);
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

  it("refuses a blank line, as a command once set can't be cleared", () => {
    expect(commandProblem("lint", " ")).toBe("The lint command can't be empty.");
  });
});

describe("trimmedInstallInputs", () => {
  it("keeps each file once, without blanks, with / between folders", () => {
    expect(
      trimmedInstallInputs([
        " package-lock.json ",
        "",
        ".\\package-lock.json",
        "apps\\web//package.json",
        "  ",
      ]),
    ).toEqual(["package-lock.json", "apps/web/package.json"]);
  });
});

describe("installInputsProblems", () => {
  it("takes paths inside the repository", () => {
    expect(installInputsProblems(["package-lock.json", "apps/web/package.json"])).toEqual([]);
  });

  it.each([
    ["/etc/npmrc", "/etc/npmrc"],
    ["C:\\Users\\me\\.npmrc", "C:/Users/me/.npmrc"],
    ["..\\shared\\package-lock.json", "../shared/package-lock.json"],
    ["apps/../../package.json", "apps/../../package.json"],
  ])("refuses %j, which is outside it", (input, kept) => {
    expect(installInputsProblems([input])).toEqual([
      `An install input is a path inside the repository; "${kept}" is not.`,
    ]);
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
