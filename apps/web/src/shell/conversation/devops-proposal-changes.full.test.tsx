import type { ProjectPipelineCheck, Stage, StageChange } from "@the-office/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  ProposedActionChanges,
  ProposedCommandChanges,
  ProposedProjectPipelineFields,
  ProposedTestTargetChanges,
} from "./devops-proposal-changes.tsx";
import { FULL_NOW, FULL_PROPOSED, FULL_ROUTES } from "./proposed-routes.fixtures.ts";
import { ProposedRouteChanges } from "./proposed-route-changes.tsx";

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
                from: { name: "Test", kind: "test", commandLine: "npm test", rerunCommandLine: "" },
                to: {
                  name: "Unit tests",
                  kind: "test",
                  commandLine: "npm test",
                  rerunCommandLine: "",
                },
              },
              {
                key: "lint",
                from: {
                  name: "Lint",
                  kind: "lint",
                  commandLine: "npm run lint",
                  rerunCommandLine: "",
                },
                to: {
                  name: "Lint",
                  kind: "lint",
                  commandLine: "npm run lint:all",
                  rerunCommandLine: "",
                },
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

  it("shows a test command's re-run command from now to as proposed", () => {
    const test = { name: "Test", kind: "test", commandLine: "npm test" } as const;
    const rows = rowsOf(
      renderToStaticMarkup(
        <ProposedCommandChanges
          changes={{
            commands: [
              {
                key: "test",
                from: { ...test, rerunCommandLine: "" },
                to: { ...test, rerunCommandLine: "npm test -- --last-failed" },
              },
            ],
          }}
        />,
      ),
    );

    expect(rows).toEqual([
      "Test (test)Test · npm testTest · npm test · re-run npm test -- --last-failed",
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

describe("ProposedTestTargetChanges", () => {
  const web = {
    key: "web",
    name: "Web app",
    kind: "hosted" as const,
    entryPoint: {
      kind: "package-script" as const,
      manifest: "package.json",
      script: "start",
      arguments: [],
    },
    port: 3000,
    variables: [],
    secretVariables: ["API_TOKEN"],
    commandsBefore: [],
    portVariable: "PORT",
    memoryMegabytes: null,
  };

  function shown() {
    const box = document.createElement("div");
    box.innerHTML = renderToStaticMarkup(
      <ProposedTestTargetChanges
        changes={{
          targets: [
            { key: "web", from: web, to: { ...web, port: 4000 }, userSet: ["port"] },
            {
              key: "android",
              from: null,
              to: {
                key: "android",
                name: "Android",
                kind: "build-to-install",
                entryPoint: { kind: "gradle-task", task: "assembleDebug", arguments: [] },
                outputPatterns: ["app/*.apk"],
                variables: [{ name: "MODE", value: "test" }],
                secretVariables: [],
                commandsBefore: ["install-tools"],
                memoryMegabytes: 4096,
              },
              userSet: [],
            },
            { key: "old", from: { ...web, key: "old", name: "Old" }, to: null, userSet: [] },
          ],
        }}
      />,
    );
    return [...box.querySelectorAll("[role=group]")].map((group) => ({
      title: group.querySelector(".proposal-section-title")?.textContent,
      struck: group.querySelector(".proposal-section-title s") !== null,
      rows: [...group.querySelectorAll("li")].map((row) => row.textContent),
    }));
  }

  it("shows each value changed as it was and as proposed, flagging one the user set", () => {
    expect(shown()[0]).toEqual({
      title: "Web app (web) · Changed",
      struck: false,
      rows: ["Port30004000You set this"],
    });
  });

  it("shows a target added from nothing, Secret variables by name alone", () => {
    expect(shown()[1]).toEqual({
      title: "Android (android) · Added",
      struck: false,
      rows: [
        "NameAndroid",
        "KindBuild to install",
        "Entry point./gradlew assembleDebug",
        "Commands before the entry pointinstall-tools",
        "Output filesapp/*.apk",
        "VariablesMODE=test",
        "Secret variablesNone",
        "Memory per service4 GB",
      ],
    });
  });

  it("strikes a removed target through, each of its values going", () => {
    const removed = shown()[2];
    expect(removed?.struck).toBe(true);
    expect(removed?.title).toBe("Old (old) · Removed");
    expect(removed?.rows).toContain("Secret variablesAPI_TOKENRemoved");
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
          routes: null,
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
          routes: null,
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

/** Each "Routes out of …" row: its Stage, then its Was and Proposed sides' words. */
function routeChangesOf(markup: string): string[][] {
  const list = document.createElement("div");
  list.innerHTML = markup;
  return [...list.querySelectorAll(".proposal-route-values")].map((values) => [
    values.parentElement?.querySelector(".proposal-change-label")?.textContent ?? "",
    ...[...values.querySelectorAll(".proposal-route-side")].map((side) =>
      [...side.querySelectorAll("li, .proposal-route-none")]
        .map((line) => line.textContent ?? "")
        .join(" | "),
    ),
  ]);
}

describe("ProposedRouteChanges", () => {
  it("shows each changed Stage's routes out as Was and Proposed, new and removed Stages too", () => {
    const markup = renderToStaticMarkup(
      <ProposedRouteChanges routes={FULL_ROUTES} was={FULL_NOW} proposed={FULL_PROPOSED} />,
    );

    expect(routeChangesOf(markup)).toEqual([
      [
        "Routes out of Tests",
        "→ Review & fix, always",
        "→ Review & fix when Implement changed files | → Publish otherwise",
      ],
      ["Routes out of Review & fix", "→ Docs, always", "→ Verify on Linux, always"],
      ["Routes out of Verify on Linux", "None: a new Stage", "→ Publish, always"],
      ["Routes out of Docs", "→ Publish, always", "None: the Stage is removed"],
    ]);
    expect(markup).toContain('class="proposal-route-side proposal-route-side--from"');
  });
});

describe("ProposedProjectPipelineFields with routes", () => {
  const changeRoutes: StageChange = {
    kind: "change-routes",
    stageKey: "tests",
    stageName: "Tests",
    routes: FULL_ROUTES.stages[0]?.to ?? [],
  };

  it("lists a Change routes as Changes X's routes, with its routes out as Was and Proposed", () => {
    const fields = {
      name: "Full for the-office",
      description: "",
      basePipelineId: "full",
    };
    const markup = renderToStaticMarkup(
      <ProposedProjectPipelineFields
        change={{
          kind: "project-pipeline",
          routes: { stages: FULL_ROUTES.stages.slice(0, 1), check: [] },
          projectId: "the-office",
          pipelineId: "pp-full",
          from: { ...fields, stageChanges: [] },
          to: { ...fields, stageChanges: [changeRoutes] },
        }}
        projectName="the-office"
        pipelineName={(id) => (id === "full" ? "Full" : id)}
        was={checked(FULL_NOW.map(baseRow))}
        proposed={checked(FULL_PROPOSED.map(baseRow))}
        roles={[]}
      />,
    );

    expect(fieldsOfMarkup(markup)[0]).toMatch(/^NewChanges Tests's routes/);
    expect(routeChangesOf(markup)).toEqual([
      [
        "Routes out of Tests",
        "→ Review & fix, always",
        "→ Review & fix when Implement changed files | → Publish otherwise",
      ],
    ]);
  });
});

describe("ProposedActionChanges", () => {
  const install = {
    key: "install-phone",
    name: "Install on my phone",
    kind: "test-target",
    leavesTheWorkstation: false,
    settings: { targetKey: "android" },
  } as const;

  it("shows each value changed, flagging one the user set and a Leaves the workstation it adds", () => {
    const rows = rowsOf(
      renderToStaticMarkup(
        <ProposedActionChanges
          changes={{
            actions: [
              {
                key: "install-phone",
                from: install,
                to: { ...install, name: "Install on a phone", leavesTheWorkstation: true },
                userSet: ["name"],
              },
            ],
          }}
        />,
      ),
    );

    expect(rows).toEqual([
      "NameInstall on my phoneInstall on a phoneYou set this",
      "Leaves the workstationNoYesMarks it Leaves the workstation",
    ]);
  });

  it("shows an Action added from nothing, and strikes a removed one through", () => {
    const markup = renderToStaticMarkup(
      <ProposedActionChanges
        changes={{
          actions: [
            {
              key: "release",
              from: null,
              to: {
                key: "release",
                name: "Release",
                kind: "workflow",
                leavesTheWorkstation: true,
                settings: { file: "release.yml", inputs: { channel: "beta" } },
              },
              userSet: [],
            },
            { key: "install-phone", from: install, to: null, userSet: [] },
          ],
        }}
      />,
    );

    expect(rowsOf(markup).slice(0, 4)).toEqual([
      "NameRelease",
      "KindWorkflow",
      "What it runsrelease.yml with channel=beta",
      "Leaves the workstationYesMarks it Leaves the workstation",
    ]);
    expect(markup).toContain("<s>Install on my phone (install-phone)</s>");
    expect(rowsOf(markup)[4]).toBe("NameInstall on my phoneRemoved");
  });
});
