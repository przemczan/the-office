import type { ProjectPipelineCheck, Stage, StageChange } from "@the-office/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  ProposedCommandChanges,
  ProposedProjectPipelineFields,
} from "./devops-proposal-changes.tsx";

function rowsOf(markup: string): string[] {
  const list = document.createElement("div");
  list.innerHTML = markup;
  return [...list.querySelectorAll("li")].map((row) => row.textContent ?? "");
}

describe("ProposedCommandChanges", () => {
  it("shows a command's name on both sides only when the Proposal renames it", () => {
    const rows = rowsOf(
      renderToStaticMarkup(
        <ProposedCommandChanges
          changes={{
            commands: [
              {
                key: "test",
                from: { name: "Test", kind: "test", commandLine: "npm test" },
                to: { name: "Unit tests", kind: "test", commandLine: "npm test" },
              },
              {
                key: "lint",
                from: { name: "Lint", kind: "lint", commandLine: "npm run lint" },
                to: { name: "Lint", kind: "lint", commandLine: "npm run lint:all" },
              },
            ],
          }}
        />,
      ),
    );

    expect(rows).toEqual([
      "Test (test)Test · Test · npm testUnit tests · Test · npm test",
      "Lint (lint)Lint · npm run lintLint · npm run lint:all",
    ]);
  });

  it("shows the before and after publishing lines from now to as proposed, None when blank", () => {
    const rows = rowsOf(
      renderToStaticMarkup(
        <ProposedCommandChanges
          changes={{
            beforePublishingCommand: { from: "", to: "npm run changelog" },
            afterPublishingCommand: { from: "./notify.sh", to: "" },
            commands: [],
          }}
        />,
      ),
    );

    expect(rows).toEqual([
      "Before publishingNonenpm run changelog",
      "After publishing./notify.shNone",
    ]);
  });
});

const IMPLEMENT: Stage = {
  kind: "agent",
  key: "implement",
  name: "Implement",
  role: "developer",
  brief: "Implement the Plan.",
  session: "fresh",
  budget: 200_000,
  optional: false,
};
const TESTS: Stage = {
  kind: "script",
  key: "tests",
  name: "Tests",
  command: "test",
  optional: false,
};
const LINUX: Stage = {
  kind: "script",
  key: "linux",
  name: "Verify on Linux",
  command: "linux",
  optional: false,
};

const INSERT_LINUX: StageChange = {
  kind: "insert-after",
  stageKey: "tests",
  stageName: "Tests",
  stage: LINUX,
};

/** A check's answer built from the rows, as the service answers it. */
function checked(rows: ProjectPipelineCheck["rows"]): ProjectPipelineCheck {
  return {
    problems: [],
    flags: [],
    rows,
    stages: rows.filter(({ origin }) => origin !== "removed").map(({ stage }) => stage),
    broken: [],
  };
}

function baseRow(stage: Stage): ProjectPipelineCheck["rows"][number] {
  return { stage, origin: "base", stageChangeIndexes: [], baseStage: stage, changedFields: [] };
}

const WAS = checked([
  baseRow(IMPLEMENT),
  baseRow(TESTS),
  { stage: LINUX, origin: "inserted", stageChangeIndexes: [0], baseStage: null, changedFields: [] },
]);

function fieldsOfMarkup(markup: string): string[] {
  const list = document.createElement("div");
  list.innerHTML = markup;
  return [...list.querySelectorAll(".proposal-field")].map((field) => field.textContent ?? "");
}

describe("ProposedProjectPipelineFields", () => {
  it("shows a new one's every value, its Stage changes as New and what its Project gets", () => {
    const markup = renderToStaticMarkup(
      <ProposedProjectPipelineFields
        change={{
          kind: "project-pipeline",
          projectId: "the-office",
          pipelineId: null,
          from: null,
          to: {
            name: "Full with Linux check",
            description: "",
            basePipelineId: "full",
            stageChanges: [{ kind: "insert-after", stageKey: "tests", stage: LINUX }],
          },
        }}
        projectName="the-office"
        pipelineName={(id) => (id === "full" ? "Full" : id)}
        was={undefined}
        proposed={WAS}
        roles={[]}
      />,
    );

    expect(rowsOf(markup)).toEqual([
      "Projectthe-office",
      "NameFull with Linux check",
      "Base PipelineFull",
      "DescriptionNone",
      "the-office getsImplement → Tests → Verify on Linux",
    ]);
    expect(markup).toContain("Stage changes · 1");
    expect(fieldsOfMarkup(markup)).toEqual(["NewInserts Verify on Linux after Tests"]);
  });

  it("shows only what a change rewrites, each Stage change Kept or New, a Change's fields as was and proposed", () => {
    const changedImplement = { ...IMPLEMENT, brief: "Implement it, then lint." };
    const markup = renderToStaticMarkup(
      <ProposedProjectPipelineFields
        change={{
          kind: "project-pipeline",
          projectId: "the-office",
          pipelineId: "pp-linux",
          from: {
            name: "Full with Linux check",
            description: "Then Linux.",
            basePipelineId: "full",
            stageChanges: [INSERT_LINUX],
          },
          to: {
            name: "Full with Linux check",
            description: "Then Linux.",
            basePipelineId: "full",
            stageChanges: [
              { kind: "insert-after", stageKey: "tests", stage: LINUX },
              {
                kind: "change",
                stageKey: "implement",
                fields: { brief: "Implement it, then lint." },
              },
            ],
          },
        }}
        projectName="the-office"
        pipelineName={(id) => (id === "full" ? "Full" : id)}
        was={WAS}
        proposed={checked([
          {
            stage: changedImplement,
            origin: "changed",
            stageChangeIndexes: [1],
            baseStage: IMPLEMENT,
            changedFields: ["brief"],
          },
          baseRow(TESTS),
          {
            stage: LINUX,
            origin: "inserted",
            stageChangeIndexes: [0],
            baseStage: null,
            changedFields: [],
          },
        ])}
        roles={[]}
      />,
    );

    expect(rowsOf(markup)).toEqual([
      "Stage changes12",
      "BriefImplement the Plan.Implement it, then lint.",
      "the-office getsImplement → Tests → Verify on Linux",
    ]);
    expect(markup).toContain("Stage changes, as proposed");
    expect(fieldsOfMarkup(markup)).toEqual([
      "KeptInserts Verify on Linux after Tests",
      "NewChanges ImplementBriefImplement the Plan.Implement it, then lint.",
    ]);
  });
});
