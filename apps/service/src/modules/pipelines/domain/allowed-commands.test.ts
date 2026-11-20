import { describe, expect, it } from "vitest";
import { allowedCommands, commandKeyRefusal, stageProjectCommands } from "./allowed-commands.js";
import { defaultPromptTexts } from "../../prompt-templates/index.js";
import { PIPELINES_PROMPT_TEMPLATES } from "./pipelines-prompt-templates.js";

const prompts = defaultPromptTexts(PIPELINES_PROMPT_TEMPLATES);

const GIT = ["status", "diff"];
const COMMANDS = [
  { key: "build", name: "Build", commandLine: "npm run build" },
  { key: "lint", name: "Lint", commandLine: "" },
  { key: "test", name: "Test", commandLine: "npm test" },
  { key: "test-full", name: "Full tests", commandLine: "npm run test:full" },
];
/** The-office's two test commands. */
const THE_OFFICE = [
  { key: "test", name: "Tests", commandLine: "npm run verify" },
  { key: "test-full", name: "Full tests", commandLine: "npm run verify:full" },
];

describe("stageProjectCommands", () => {
  it("keeps every set command when the Stage doesn't narrow", () => {
    expect(stageProjectCommands(COMMANDS, undefined).map(({ key }) => key)).toEqual([
      "build",
      "test",
      "test-full",
    ]);
  });

  it("keeps only the listed keys, in the Project's order", () => {
    expect(stageProjectCommands(COMMANDS, ["test", "build"]).map(({ key }) => key)).toEqual([
      "build",
      "test",
    ]);
  });

  it("adds nothing for a key the Project lacks or left blank", () => {
    expect(stageProjectCommands(COMMANDS, ["test", "lint", "e2e"]).map(({ key }) => key)).toEqual([
      "test",
    ]);
  });
});

describe("allowedCommands with a narrowing", () => {
  it("under the Project's own commands, allows and names only the narrowed lines", () => {
    expect(allowedCommands(prompts, "project-commands", THE_OFFICE, ["test"], GIT)).toEqual({
      permission: { kind: "project-commands", commandLines: ["npm run verify"] },
      words:
        "You may run the Project's commands, exactly as written, and read-only git (git status, git diff):\n\n- test (Tests): `npm run verify`",
    });
  });

  it("under the Project's own commands, falls back to git when none of the listed keys is set", () => {
    expect(allowedCommands(prompts, "project-commands", COMMANDS, ["lint"], GIT)).toEqual({
      permission: { kind: "project-commands", commandLines: [] },
      words:
        "None of the Project's commands is for this Stage, so you may run read-only git (git status, git diff) only.",
    });
  });

  it("under anything, names the commands to run and the others as not for this Stage", () => {
    expect(allowedCommands(prompts, "anything", THE_OFFICE, ["test"], GIT)).toEqual({
      permission: { kind: "anything" },
      words:
        "You may run any command in the worktree, but no git command that changes anything: besides read-only git (git status, git diff), git is The Office's.\n\nOf the Project's own commands, run only these, by their key with run_project_command or exactly as written:\n\n- test (Tests): `npm run verify`\n\nThe others (test-full) are not for this Stage.",
    });
  });

  it("under anything, leaves the others out when the Stage keeps every set command", () => {
    expect(
      allowedCommands(prompts, "anything", THE_OFFICE, ["test", "test-full"], GIT).words,
    ).not.toContain("The others");
  });

  it("under read-only git, doesn't change the words", () => {
    expect(allowedCommands(prompts, "read-only-git", COMMANDS, ["test"], GIT)).toEqual(
      allowedCommands(prompts, "read-only-git", COMMANDS, undefined, GIT),
    );
  });
});

describe("commandKeyRefusal", () => {
  it("refuses a key outside the narrowing, naming the keys the Stage may run", () => {
    expect(commandKeyRefusal("test-full", THE_OFFICE, ["test"])).toBe(
      "The test-full command isn't one this Stage may run; it may run test.",
    );
  });

  it("says so when the Stage may run none of the Project's commands", () => {
    expect(commandKeyRefusal("build", COMMANDS, ["lint"])).toBe(
      "The build command isn't one this Stage may run; it may run none of the Project's commands.",
    );
  });

  it("lets through a listed key, install, and any key when the Stage doesn't narrow", () => {
    expect(commandKeyRefusal("test", THE_OFFICE, ["test"])).toBeUndefined();
    expect(commandKeyRefusal("install", THE_OFFICE, ["test"])).toBeUndefined();
    expect(commandKeyRefusal("test-full", THE_OFFICE, undefined)).toBeUndefined();
  });
});
