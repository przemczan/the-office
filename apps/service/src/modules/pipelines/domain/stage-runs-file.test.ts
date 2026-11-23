import { describe, expect, it } from "vitest";
import { asFlow } from "./flow.js";
import { RESOLVE_KEY, RESOLVE_TEST_KEY } from "./publish-stages.js";
import type { Stage } from "./stage.js";
import { agentStage, gate, keptPublishStage, publishStage, scriptStage } from "./stage.fixtures.js";
import type { StageCommandRun } from "./stage-command-run.js";
import type { StageRun } from "./stage-run.js";
import { aStageRun } from "./stage-run.fixtures.js";
import { stageRunsFile } from "./stage-runs-file.js";

const TASK = { id: "6b5af1e7", title: "Add routes", project: "the-office" };

/** The route from Tests to End, followed twice before, at most 3 times. */
const AT_END = { from: "tests", to: null, times: 2, limit: 3 };
const DEFINITION_OF_DONE = ["Routes are kept", "Conditions are weighed", "The docs say so"];

const implement = agentStage();
const tests = scriptStage();
const review = gate({ key: "review", name: "Review" });
const publish = publishStage();
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
  it("is version 2 in the spec's shape, an Agent's choice among it, the run the route leaves last", () => {
    const runs: StageRun[] = [
      aStageRun({
        roleKey: "developer",
        startedAt: at(0),
        endedAt: at(40),
        changedFiles: ["docs/spec/2.3-pipelines.md"],
        choice: { to: "tests", reason: "The routes need their tests." },
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
      stageRunsFile(
        TASK,
        { from: "tests", to: "review", times: 1, limit: null },
        DEFINITION_OF_DONE,
        runs,
        stages,
      ),
    ).toEqual({
      version: 2,
      task: TASK,
      route: { from: "tests", to: "review", times: 1, limit: null },
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
          result: null,
          choice: { to: "tests", reason: "The routes need their tests." },
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
          result: null,
          choice: null,
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

    const file = stageRunsFile(TASK, AT_END, [], runs, stages);

    expect(file.route).toEqual(AT_END);
    expect(file.stageRuns.map(({ stage, run }) => `${stage} ${run}`)).toEqual([
      "implement 1",
      "tests 1",
      "implement 2",
      "tests 2",
    ]);
    expect(file.stageRuns.at(-1)?.command).toEqual({ key: "test", exitCode: 0 });
  });

  it("holds a Publish run's result, done when it names one, and no command, and the conflict chain's runs by the Stages as read", () => {
    const conflicted = aStageRun({
      number: 2,
      stageKey: "publish",
      outcome: {
        status: "failed",
        error: "The base moved.",
        baseMoved: { conflictedFiles: ["a.ts"] },
      },
    });
    const published = aStageRun({
      number: 5,
      stageKey: "publish",
      outcome: { status: "done", summary: "Merged.", publishResult: "published" },
    });
    const runs = [
      aStageRun({ number: 1, stageKey: "tests", commandRuns: [testRun(0)] }),
      conflicted,
      aStageRun({ number: 3, stageKey: RESOLVE_KEY, roleKey: "developer" }),
      aStageRun({ number: 4, stageKey: RESOLVE_TEST_KEY, commandRuns: [testRun(0)] }),
      published,
    ];

    const file = stageRunsFile(
      TASK,
      { from: "publish", to: null, times: 0, limit: null },
      [],
      runs,
      asFlow([implement, tests, keptPublishStage()]),
    );

    expect(
      file.stageRuns.map(({ stage, kind, outcome, result, command }) => [
        stage,
        kind,
        outcome,
        result,
        command,
      ]),
    ).toEqual([
      ["tests", "script", "done", null, { key: "test", exitCode: 0 }],
      ["publish", "publish", "done", "conflict", null],
      [RESOLVE_KEY, "agent", "done", null, null],
      [RESOLVE_TEST_KEY, "script", "done", null, { key: "test", exitCode: 0 }],
      ["publish", "publish", "done", "published", null],
    ]);
  });

  it("gives a failed Publish run no result, as its outcome says it, and keeps a removed Publish Stage's kind", () => {
    const runs = [
      aStageRun({
        stageKey: "publish",
        outcome: { status: "failed", error: "Push refused.", publishResult: "failed" },
      }),
      aStageRun({
        number: 2,
        stageKey: "gone",
        outcome: { status: "done", summary: "Pushed.", publishResult: "nothing-to-publish" },
      }),
    ];

    const file = stageRunsFile(TASK, AT_END, [], runs, stages);

    expect(file.stageRuns.map(({ kind, outcome, result }) => [kind, outcome, result])).toEqual([
      ["publish", "failed", null],
      ["publish", "done", "nothing-to-publish"],
    ]);
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

    const file = stageRunsFile(TASK, { ...AT_END, from: "implement" }, [], runs, stages);

    expect(file.stageRuns.map(({ outcome, error }) => [outcome, error])).toEqual([
      ["skipped", null],
      ["held", null],
      ["held", null],
    ]);
  });

  it("lists no changed files for a run that kept none, and no command for one that didn't run", () => {
    const runs = [aStageRun({ stageKey: "tests", changedFiles: undefined, commandRuns: [] })];

    const [only] = stageRunsFile(TASK, AT_END, [], runs, stages).stageRuns;

    expect(only?.changedFiles).toEqual([]);
    expect(only?.command).toEqual({ key: "test", exitCode: null });
  });
});
