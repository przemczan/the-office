import { describe, expect, it } from "vitest";
import { aProject, startingCommands } from "./project.fixtures.js";
import {
  proposedCommands,
  proposedCommandsProblems,
  type ProposedCommands,
} from "./proposed-commands.js";

const TEST = { name: "Test", kind: "test", commandLine: "npm test", rerunCommandLine: "" } as const;
const E2E = {
  name: "End to end",
  kind: "test",
  commandLine: "npm run e2e",
  rerunCommandLine: "",
} as const;

describe("proposedCommands", () => {
  it("keeps only what differs, each with the Project's value now", () => {
    const project = aProject();

    expect(
      proposedCommands(project, {
        installCommand: " npm install ",
        installInputs: ["package-lock.json", " .nvmrc "],
        commands: [
          { key: "test", ...TEST, commandLine: " npm run test:all ", rerunCommandLine: "" },
          {
            key: "lint",
            name: "Lint",
            kind: "lint",
            commandLine: "npm run lint",
            rerunCommandLine: "",
          },
          { key: "test-e2e", ...E2E },
        ],
        removeCommands: ["build"],
      }),
    ).toEqual({
      installCommand: { from: "npm ci", to: "npm install" },
      installInputs: { from: ["package-lock.json"], to: ["package-lock.json", ".nvmrc"] },
      commands: [
        {
          key: "test",
          from: TEST,
          to: { ...TEST, commandLine: "npm run test:all", rerunCommandLine: "" },
        },
        { key: "test-e2e", from: null, to: E2E },
        {
          key: "build",
          from: {
            name: "Build",
            kind: "build",
            commandLine: "npm run build",
            rerunCommandLine: "",
          },
          to: null,
        },
      ],
    });
    expect(proposedCommands(project, { installInputs: ["package-lock.json"] })).toEqual({
      installCommand: undefined,
      installInputs: undefined,
      commands: [],
    });
  });

  it("removes a command also given, and keeps the last of a key given twice", () => {
    expect(
      proposedCommands(aProject(), {
        commands: [
          { key: "test-e2e", ...E2E },
          { key: "test-e2e", ...E2E, name: "E2E" },
          { key: "lint", name: "Lint", kind: "lint", commandLine: "oxlint", rerunCommandLine: "" },
        ],
        removeCommands: ["lint"],
      }).commands,
    ).toEqual([
      { key: "test-e2e", from: null, to: { ...E2E, name: "E2E" } },
      {
        key: "lint",
        from: { name: "Lint", kind: "lint", commandLine: "npm run lint", rerunCommandLine: "" },
        to: null,
      },
    ]);
  });
});

describe("proposedCommandsProblems", () => {
  const proposed: ProposedCommands = {
    installCommand: { from: "npm ci", to: "npm install" },
    installInputs: { from: ["package-lock.json"], to: [".nvmrc"] },
    commands: [
      { key: "test", from: TEST, to: { ...TEST, kind: "build" } },
      { key: "test-e2e", from: null, to: E2E },
      {
        key: "lint",
        from: { name: "Lint", kind: "lint", commandLine: "npm run lint", rerunCommandLine: "" },
        to: null,
      },
    ],
  };

  it("allows a change whose fields are as they were when it was drafted", () => {
    expect(proposedCommandsProblems(aProject(), proposed)).toEqual([]);
  });

  it("sets a command the Project doesn't have set yet", () => {
    const project = aProject({ commands: startingCommands({ test: "" }) });
    const setting = proposedCommands(project, { commands: [{ key: "test", ...TEST }] });

    expect(setting.commands).toEqual([
      { key: "test", from: { ...TEST, commandLine: "", rerunCommandLine: "" }, to: TEST },
    ]);
    expect(proposedCommandsProblems(project, setting)).toEqual([]);
  });

  it("refuses a change once a field it changes changed since it was drafted", () => {
    const project = aProject({
      installCommand: "pnpm install",
      installInputs: ["pnpm-lock.yaml"],
      commands: [
        ...startingCommands({ test: "vitest run" }).filter(({ key }) => key !== "lint"),
        { key: "test-e2e", ...E2E },
      ],
    });

    expect(proposedCommandsProblems(project, proposed)).toEqual([
      "The install command changed since this was proposed.",
      "The install inputs changed since this was proposed.",
      "The test command changed since this was proposed.",
      "The Project got a test-e2e command since this was proposed.",
      "The lint command changed since this was proposed.",
    ]);
  });

  it("refuses what the Project page refuses, and a change of nothing", () => {
    expect(
      proposedCommandsProblems(aProject(), {
        installCommand: { from: "npm ci", to: " " },
        installInputs: { from: ["package-lock.json"], to: ["../outside"] },
        commands: [
          { key: "test", from: TEST, to: { ...TEST, commandLine: " ", rerunCommandLine: "" } },
          { key: "publish", from: null, to: E2E },
          { key: "e2e", from: null, to: null },
        ],
      }),
    ).toEqual([
      "The install command can't be empty.",
      'An install input is a path inside the repository; "../outside" is not.',
      "The test command can't be empty.",
      'The key "publish" is kept for The Office\'s own use.',
      'The Project has no command with the key "e2e".',
    ]);
    expect(proposedCommandsProblems(aProject(), { commands: [] })).toEqual([
      "Nothing changes: give the install command, install inputs, before or after publishing lines or commands that change, each one whole.",
    ]);
  });
});

describe("A Proposal of the publishing lines", () => {
  const project = aProject({ afterPublishingCommand: "gh workflow run release.yml" });

  it("keeps each line that differs, with its value now, and may clear one", () => {
    expect(
      proposedCommands(project, {
        beforePublishingCommand: " npx changeset version ",
        afterPublishingCommand: "",
      }),
    ).toMatchObject({
      beforePublishingCommand: { from: "", to: "npx changeset version" },
      afterPublishingCommand: { from: "gh workflow run release.yml", to: "" },
    });
    expect(
      proposedCommands(project, { afterPublishingCommand: "gh workflow run release.yml" })
        .afterPublishingCommand,
    ).toBeUndefined();
  });

  it("applies while each line is as it was, and is refused once one changed or breaks a rule", () => {
    const proposed: ProposedCommands = {
      beforePublishingCommand: { from: "", to: "npx changeset version" },
      afterPublishingCommand: { from: "gh workflow run release.yml", to: "" },
      commands: [],
    };

    expect(proposedCommandsProblems(project, proposed)).toEqual([]);
    expect(
      proposedCommandsProblems(aProject({ beforePublishingCommand: "make release" }), proposed),
    ).toEqual([
      "The before publishing line changed since this was proposed.",
      "The after publishing line changed since this was proposed.",
    ]);
    expect(
      proposedCommandsProblems(project, {
        beforePublishingCommand: { from: "", to: "one\ntwo" },
        commands: [],
      }),
    ).toEqual(["The before publishing command must be one line."]);
  });
});
