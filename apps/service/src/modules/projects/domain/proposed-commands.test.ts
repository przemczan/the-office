import { describe, expect, it } from "vitest";
import { aProject } from "./project.fixtures.js";
import { proposedCommandFields, proposedCommandsProblems } from "./proposed-commands.js";

describe("proposedCommandFields", () => {
  it("keeps only what differs, each with the Project's value now", () => {
    const project = aProject();

    expect(
      proposedCommandFields(project, {
        test: " npm run test:all ",
        lint: "npm run lint",
        installInputs: ["package-lock.json", " .nvmrc "],
      }),
    ).toEqual({
      from: { test: "npm test", installInputs: ["package-lock.json"] },
      to: { test: "npm run test:all", installInputs: ["package-lock.json", ".nvmrc"] },
    });
    expect(proposedCommandFields(project, { installInputs: ["package-lock.json"] })).toEqual({
      from: {},
      to: {},
    });
  });
});

describe("proposedCommandsProblems", () => {
  const from = { test: "npm test", installInputs: ["package-lock.json"] };

  it("allows a change whose fields are as they were when it was drafted", () => {
    expect(
      proposedCommandsProblems(aProject(), from, {
        test: "npm run test:all",
        installInputs: [".nvmrc"],
      }),
    ).toEqual([]);
  });

  it("refuses a change once a field it rewrites changed since it was drafted", () => {
    const project = aProject({
      commands: { ...aProject().commands, test: "vitest run" },
      installInputs: ["pnpm-lock.yaml"],
    });

    expect(
      proposedCommandsProblems(project, from, {
        test: "npm run test:all",
        installInputs: [".nvmrc"],
      }),
    ).toEqual([
      "The test command changed since this was proposed.",
      "The install inputs changed since this was proposed.",
    ]);
  });

  it("refuses what the Project page refuses, and a change of nothing", () => {
    expect(
      proposedCommandsProblems(aProject(), from, { test: " ", installInputs: ["../outside"] }),
    ).toEqual([
      "The test command can't be empty.",
      'An install input is a path inside the repository; "../outside" is not.',
    ]);
    expect(proposedCommandsProblems(aProject(), {}, {})).toEqual([
      "Nothing changes: give the commands or install inputs that change, each one whole.",
    ]);
  });
});
