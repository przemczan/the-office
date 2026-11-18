import { describe, expect, it } from "vitest";
import { RESOLVE_KEY, RESOLVE_TEST_KEY, walkedStages } from "./resolve-stages.js";
import { plainRoute } from "./route.js";
import type { Stage } from "./stage.js";
import { agentStage, gate, scriptStage } from "./stage.fixtures.js";
import type { StageCommandRun } from "./stage-command-run.js";
import type { StageRun } from "./stage-run.js";
import { aStageRun } from "./stage-run.fixtures.js";
import { stageRunsFile } from "./stage-runs-file.js";

const TASK = { id: "6b5af1e7", title: "Add routes", project: "the-office" };
const DEFINITION_OF_DONE = ["Routes are kept", "Conditions are weighed", "The docs say so"];

const implement = agentStage();
const tests = scriptStage();
const review = gate({ key: "review", name: "Review" });
const publish = scriptStage({ key: "publish", name: "Publish", command: "publish" });
const stages: Stage[] = [implement, tests, review, publish];

function testRun(exitCode: number | undefined): StageCommandRun {
  return {
    purpose: "command",
    commandLine: "npm test",
    outcome: exitCode === 0 ? "passed" : "failed",
    exitCode,
    durationMs: 1000,
    output: "",
  };
}

function at(minute: number): Date {
  return new Date(Date.UTC(2026, 10, 17, 10, minute));
}

describe("stageRunsFile", () => {
  it("is version 1 in the spec's shape, the run the route leaves last", () => {
    const runs: StageRun[] = [
      aStageRun({
        roleKey: "developer",
        startedAt: at(0),
        endedAt: at(40),
        changedFiles: ["docs/spec/2.3-pipelines.md"],
        outcome: {
          status: "done",
          summary: "Done.",
          definitionOfDoneMet: [1],
          definitionOfDoneOutOfReach: [{ statement: 2, why: "Needs a live check." }],
          handoverNote: "Routes are in.",
        },
      }),
      aStageRun({
        id: "run-2",
        number: 2,
        stageKey: "tests",
        startedAt: at(41),
        endedAt: at(49),
        changedFiles: [],
        commandRuns: [testRun(1)],
        outcome: { status: "failed", error: "1 test failed." },
      }),
    ];

    expect(
      stageRunsFile(TASK, { from: "tests", to: "review" }, DEFINITION_OF_DONE, runs, stages),
    ).toEqual({
      version: 1,
      task: TASK,
      route: { from: "tests", to: "review" },
      definitionOfDone: [
        { number: 1, statement: "Routes are kept", state: "reported-met" },
        {
          number: 2,
          statement: "Conditions are weighed",
          state: "out-of-reach",
          why: "Needs a live check.",
        },
        { number: 3, statement: "The docs say so", state: "not-met" },
      ],
      stageRuns: [
        {
          stage: "implement",
          name: "Implement",
          kind: "agent",
          run: 1,
          startedAt: "2026-11-17T10:00:00.000Z",
          endedAt: "2026-11-17T10:40:00.000Z",
          outcome: "done",
          changedFiles: ["docs/spec/2.3-pipelines.md"],
          handoverNote: "Routes are in.",
          error: null,
          command: null,
        },
        {
          stage: "tests",
          name: "Tests",
          kind: "script",
          run: 1,
          startedAt: "2026-11-17T10:41:00.000Z",
          endedAt: "2026-11-17T10:49:00.000Z",
          outcome: "failed",
          changedFiles: [],
          handoverNote: null,
          error: "1 test failed.",
          command: { key: "test", exitCode: 1 },
        },
      ],
    });
  });

  it("numbers each Stage's runs from 1 and leaves out a run still going on", () => {
    const runs = [
      aStageRun({ number: 1 }),
      aStageRun({ number: 2, stageKey: "tests", commandRuns: [testRun(1)] }),
      aStageRun({ number: 3 }),
      aStageRun({ number: 4, stageKey: "tests", commandRuns: [testRun(0)] }),
      aStageRun({ number: 5, stageKey: "review", outcome: undefined, endedAt: undefined }),
    ];

    const file = stageRunsFile(TASK, { from: "tests", to: null }, [], runs, stages);

    expect(file.route).toEqual({ from: "tests", to: null });
    expect(file.stageRuns.map(({ stage, run }) => `${stage} ${run}`)).toEqual([
      "implement 1",
      "tests 1",
      "implement 2",
      "tests 2",
    ]);
    expect(file.stageRuns.at(-1)?.command).toEqual({ key: "test", exitCode: 0 });
  });

  it("holds Resolve's runs, by the Stages the walk walked", () => {
    const flow = [
      { ...implement, routes: [plainRoute("tests")] },
      { ...tests, routes: [plainRoute("publish")] },
      { ...publish, routes: [plainRoute(null)] },
    ];
    const conflicted = aStageRun({
      number: 2,
      stageKey: "publish",
      outcome: {
        status: "failed",
        error: "The base moved.",
        baseMoved: { conflictedFiles: ["a.ts"] },
      },
    });
    const runs = [
      aStageRun({ number: 1, stageKey: "tests", commandRuns: [testRun(0)] }),
      conflicted,
      aStageRun({ number: 3, stageKey: RESOLVE_KEY, roleKey: "developer" }),
      aStageRun({ number: 4, stageKey: RESOLVE_TEST_KEY }),
    ];

    const file = stageRunsFile(
      TASK,
      { from: RESOLVE_TEST_KEY, to: "publish" },
      [],
      runs,
      walkedStages(flow, runs),
    );

    expect(file.stageRuns.map(({ stage, kind }) => `${stage} ${kind}`)).toEqual([
      "tests script",
      "publish script",
      `${RESOLVE_KEY} agent`,
      `${RESOLVE_TEST_KEY} script`,
    ]);
    // Publish runs no Project command, so it never has an exit code.
    expect(file.stageRuns[1]?.command).toEqual({ key: "publish", exitCode: null });
  });

  it("says held for a run a Pause or the usage window held, and skipped for a skipped one", () => {
    const runs = [
      aStageRun({
        number: 1,
        stageKey: "review",
        outcome: { status: "done", summary: "", skipped: true },
      }),
      aStageRun({
        number: 2,
        outcome: { status: "failed", error: "Paused.", interrupted: "pause" },
      }),
      aStageRun({
        number: 3,
        outcome: { status: "failed", error: "Held.", interrupted: "usage-window" },
      }),
    ];

    const file = stageRunsFile(TASK, { from: "implement", to: null }, [], runs, stages);

    expect(file.stageRuns.map(({ outcome, error }) => [outcome, error])).toEqual([
      ["skipped", null],
      ["held", null],
      ["held", null],
    ]);
  });

  it("lists no changed files for a run that kept none, and no command for one that didn't run", () => {
    const runs = [aStageRun({ stageKey: "tests", changedFiles: undefined, commandRuns: [] })];

    const [only] = stageRunsFile(TASK, { from: "tests", to: null }, [], runs, stages).stageRuns;

    expect(only?.changedFiles).toEqual([]);
    expect(only?.command).toEqual({ key: "test", exitCode: null });
  });
});
