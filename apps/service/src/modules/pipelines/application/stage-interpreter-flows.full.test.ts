import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EventBus } from "../../../platform/events/event-bus.js";
import { OfficeDataDirectory } from "../../../platform/office-data/office-data-directory.js";
import { TaskPaused } from "../../work/index.js";
import { builtInPipelinesBeforeFlows } from "../domain/built-in-pipelines-before-flows.fixtures.js";
import { straightLineFlow } from "../domain/flow.js";
import type { ConditionGroup, Route } from "../domain/route.js";
import type { Stage } from "../domain/stage.js";
import type { StageOutcome, StageRun } from "../domain/stage-run.js";
import { endStageRun, startStageRun } from "../domain/stage-run-changes.js";
import {
  aDoneResult,
  anAgentSession,
  anAgentStage,
  answerLastDecision,
  runsOf,
  startPipelinesApplication,
  walkStages,
  type PipelinesApplication,
} from "../pipelines-application.fixtures.js";
import { aCommandRun } from "../ports/pipelines-ports.fixtures.js";
import { resume, soundTheAlarm } from "../stage-interpreter-alarm.fixtures.js";
import { StageRunRepository } from "../ports/stage-run-repository.js";
import { TaskStagesService } from "./task-stages-service.js";

const implement = anAgentStage("implement");
const review = anAgentStage("review", { optional: true });
const ship: Stage = {
  kind: "script",
  key: "ship",
  name: "Ship",
  optional: false,
  command: "build",
};

const LIST: readonly Stage[] = [implement, review, ship];

const WHILE_SOME_NOT_MET: ConditionGroup = {
  combine: "all",
  tests: [{ kind: "definitionOfDone", is: "some-not-met" }],
};

/** `stage` placed at `column`, `row` on the flow, going by `routes`. */
function placed(stage: Stage, column: number, row: number, routes: Route[]): Stage {
  return { ...stage, routes, place: { column, row } };
}

/** The built-in Pipeline's Stages as the list the migrations seeded, before flows. */
function pipelineNamed(name: string): readonly Stage[] {
  const pipeline = builtInPipelinesBeforeFlows.find((each) => each.id === name);
  if (!pipeline) throw new Error(`There is no built-in Pipeline "${name}".`);
  return pipeline.stages;
}

/** Each Agent Stage's session ends done, the first reporting `met` of the Definition of Done. */
function sessionsMeeting(met: readonly number[]) {
  return [
    anAgentSession(aDoneResult("Done.", "Nothing is left.", met)),
    anAgentSession(aDoneResult()),
  ];
}

async function using<T>(
  met: readonly number[],
  work: (pipelines: PipelinesApplication) => Promise<T>,
): Promise<T> {
  const pipelines = await startPipelinesApplication(sessionsMeeting(met));
  try {
    return await work(pipelines);
  } finally {
    await pipelines.app.close();
  }
}

/** What each run of the Task's walk did, in order, and how many Agent Stage sessions ran. */
function walked(stages: readonly Stage[], met: readonly number[]) {
  return using(met, async (pipelines) => {
    const taskId = await walkStages(pipelines, stages);
    const runs = (await runsOf(pipelines, taskId)).map(({ stageKey, outcome }) => [
      stageKey,
      outcome?.status,
    ]);
    return {
      runs,
      sessions: pipelines.stageThreads.requests.length,
      state: (await pipelines.tasks.read(taskId)).state,
    };
  });
}

async function progressStates(pipelines: PipelinesApplication, taskId: string) {
  const progress = await pipelines.app.get(TaskStagesService, { strict: false }).progress(taskId);
  return progress?.stages.map(({ stage, state }) => [stage.key, state]);
}

describe("A converted Pipeline's Stages", () => {
  it.each(["full", "quick-fix"])("of %s walk as the list did", async (name) => {
    const stages = pipelineNamed(name);

    const asTheList = await walked(stages, [1, 2]);
    const asAFlow = await walked(straightLineFlow(stages), [1, 2]);

    expect(asAFlow).toEqual(asTheList);
    expect(asAFlow.runs).toEqual(stages.map(({ key }) => [key, "done"]));
  });

  it("walk as the list did, passing the optional Stage by with no run once the Definition of Done is met", async () => {
    const asTheList = await walked(LIST, [1, 2]);
    const asAFlow = await walked(straightLineFlow(LIST), [1, 2]);

    expect(asAFlow).toEqual(asTheList);
    expect(asAFlow.runs).toEqual([
      ["implement", "done"],
      ["ship", "done"],
    ]);
    expect(asAFlow.sessions).toBe(1);
  });

  it("walk as the list did, running the optional Stage while something isn't met", async () => {
    const asTheList = await walked(LIST, [2]);
    const asAFlow = await walked(straightLineFlow(LIST), [2]);

    expect(asAFlow).toEqual(asTheList);
    expect(asAFlow.runs).toEqual([
      ["implement", "done"],
      ["review", "done"],
      ["ship", "done"],
    ]);
    expect(asAFlow.sessions).toBe(2);
  });

  it("show the optional Stage passed by as not taken", async () => {
    await using([1, 2], async (pipelines) => {
      const taskId = await walkStages(pipelines, LIST);

      expect(await progressStates(pipelines, taskId)).toEqual([
        ["implement", "done"],
        ["review", "not-taken"],
        ["ship", "done"],
      ]);
    });
  });

  it("carry on after a Skipped run the previous release recorded for the optional Stage", async () => {
    await using([1, 2], async (pipelines) => {
      const taskId = randomUUID();
      const repository = pipelines.app.get(StageRunRepository, { strict: false });
      const ended: [string, StageOutcome][] = [
        ["implement", { status: "done", summary: "Done.", definitionOfDoneMet: [1, 2] }],
        ["review", { status: "done", summary: "Skipped.", skipped: true }],
      ];
      for (const [index, [stageKey, outcome]] of ended.entries()) {
        const { run } = startStageRun(
          { id: randomUUID(), taskId, stageKey, carriedFailure: undefined, sentBack: undefined },
          index,
          new Date(),
        );
        await repository.saveNew(run);
        await repository.saveEnded(endStageRun(run, outcome, new Date()).run);
      }

      await walkStages(pipelines, LIST, taskId);

      const runs = await runsOf(pipelines, taskId);
      expect(runs.map(({ stageKey, outcome }) => [stageKey, outcome?.status])).toEqual([
        ["implement", "done"],
        ["review", "done"],
        ["ship", "done"],
      ]);
      expect(pipelines.stageThreads.requests).toHaveLength(0);
      expect((await pipelines.tasks.read(taskId)).state).toBe("done");
    });
  });
});

describe("A flow's routes", () => {
  /** Implement goes to Review while something isn't met, else straight to Ship. */
  const FLOW: readonly Stage[] = [
    placed(anAgentStage("implement"), 0, 0, [
      { to: "review", condition: WHILE_SOME_NOT_MET, limit: null },
      { to: "ship", condition: null, limit: null },
    ]),
    placed(anAgentStage("review"), 1, 1, [{ to: "ship", condition: null, limit: null }]),
    placed(ship, 2, 0, [{ to: null, condition: null, limit: null }]),
  ];

  it("take the branch whose condition holds, and pass the other by with no run", async () => {
    await using([1, 2], async (pipelines) => {
      const taskId = await walkStages(pipelines, FLOW);

      const runs = await runsOf(pipelines, taskId);
      expect(runs.map(({ stageKey, outcome }) => [stageKey, outcome?.status])).toEqual([
        ["implement", "done"],
        ["ship", "done"],
      ]);
      expect(await progressStates(pipelines, taskId)).toEqual([
        ["implement", "done"],
        ["review", "not-taken"],
        ["ship", "done"],
      ]);
      expect((await pipelines.tasks.read(taskId)).state).toBe("done");
    });
  });

  it("go through the conditional branch while its condition holds", async () => {
    await using([2], async (pipelines) => {
      const taskId = await walkStages(pipelines, FLOW);

      const runs = await runsOf(pipelines, taskId);
      expect(runs.map(({ stageKey }) => stageKey)).toEqual(["implement", "review", "ship"]);
      expect((await pipelines.tasks.read(taskId)).state).toBe("done");
    });
  });

  describe("when none holds", () => {
    /** Implement goes on only while something isn't met; everything is. */
    const STUCK: readonly Stage[] = [
      placed(anAgentStage("implement"), 0, 0, [
        { to: "review", condition: WHILE_SOME_NOT_MET, limit: null },
      ]),
      placed(anAgentStage("review", { name: "Review" }), 1, 0, [
        { to: null, condition: null, limit: null },
      ]),
    ];

    it("asks the user where the walk goes on, the Task waiting on them", async () => {
      await using([1, 2], async (pipelines) => {
        const taskId = await walkStages(pipelines, STUCK);

        const [decision, ...others] = pipelines.decisions.on(taskId);
        expect(others).toEqual([]);
        expect(decision?.putTo).toBeUndefined();
        expect(decision?.draft.options).toEqual(["Go on to Review", "Drop the Task"]);
        expect((await pipelines.tasks.read(taskId)).state).toBe("waiting-on-you");
        expect(pipelines.stageThreads.requests).toHaveLength(1);
      });
    });

    it("follows the route the user chose", async () => {
      await using([1, 2], async (pipelines) => {
        const taskId = await walkStages(pipelines, STUCK);

        await answerLastDecision(pipelines, taskId, { kind: "option", option: 0 });

        const runs = await runsOf(pipelines, taskId);
        expect(runs.map(({ stageKey, outcome }) => [stageKey, outcome?.status])).toEqual([
          ["implement", "done"],
          ["review", "done"],
        ]);
        expect(runs[0]?.decisions).toEqual([
          expect.objectContaining({
            kind: "no-route-holds",
            answer: { kind: "follow-route", to: "review" },
          }),
        ]);
        expect((await pipelines.tasks.read(taskId)).state).toBe("done");
      });
    });
  });
});

function walkedKeys(runs: readonly StageRun[]): string[] {
  return runs.map(({ stageKey }) => stageKey);
}

/** The keys of the condition commands run, in order. */
function conditionsRan(pipelines: PipelinesApplication): string[] {
  return pipelines.commands.ran.filter(({ key }) => key === "lint").map(({ key }) => key);
}

describe("A route whose condition runs a Project command", () => {
  /** Implement goes to Review when `lint` passes, else straight to Ship. */
  const BY_LINT: readonly Stage[] = [
    placed(anAgentStage("implement"), 0, 0, [
      {
        to: "review",
        condition: { combine: "all", tests: [{ kind: "command", key: "lint" }] },
        limit: null,
      },
      { to: "ship", condition: null, limit: null },
    ]),
    placed(anAgentStage("review", { name: "Review" }), 1, 1, [
      { to: "ship", condition: null, limit: null },
    ]),
    placed(ship, 2, 0, [{ to: null, condition: null, limit: null }]),
  ];
  const LINT_TEST = { key: "lint", to: "review", routeIndex: 0, testPath: [0] };

  it("follows the route when the command exits 0, its run kept on the run the route leaves", async () => {
    await using([1, 2], async (pipelines) => {
      const taskId = await walkStages(pipelines, BY_LINT);

      const runs = await runsOf(pipelines, taskId);
      expect(walkedKeys(runs)).toEqual(["implement", "review", "ship"]);
      expect(runs[0]?.commandRuns).toEqual([
        expect.objectContaining({
          purpose: "condition",
          commandLine: "npm run lint",
          outcome: "passed",
          condition: LINT_TEST,
        }),
      ]);
      const repository = pipelines.app.get(StageRunRepository, { strict: false });
      expect(await repository.commandOutputs(taskId, runs[0]?.id ?? "")).toEqual([""]);
      expect(pipelines.commands.ran).toContainEqual({
        taskId,
        key: "lint",
        stageRunId: runs[0]?.id,
      });
      expect((await pipelines.tasks.read(taskId)).state).toBe("done");
    });
  });

  it("gives the command the Task's earlier Stage runs in a file of the Task's own folder", async () => {
    await using([1, 2], async (pipelines) => {
      const taskId = await walkStages(pipelines, BY_LINT);

      const [file, ...others] = pipelines.commands.stageRunsFiles;
      expect(others).toEqual([]);
      expect(file?.path).toBe(
        join(pipelines.app.get(OfficeDataDirectory).stageRunsFolder(taskId), "stage-runs.json"),
      );
      expect(JSON.parse(file?.text ?? "")).toMatchObject({
        version: 2,
        task: { id: taskId },
        route: { from: "implement", to: "review", times: 0, limit: null },
        stageRuns: [{ stage: "implement", kind: "agent", run: 1, outcome: "done" }],
      });
    });
  });

  it("goes on to the next route when the command exits otherwise", async () => {
    await using([1, 2], async (pipelines) => {
      pipelines.commands.commandRuns.push([aCommandRun("npm run lint", "failed")]);

      const taskId = await walkStages(pipelines, BY_LINT);

      expect(walkedKeys(await runsOf(pipelines, taskId))).toEqual(["implement", "ship"]);
      expect(conditionsRan(pipelines)).toEqual(["lint"]);
    });
  });

  it("asks the user where the walk goes on, saying why, when the command couldn't run", async () => {
    await using([1, 2], async (pipelines) => {
      const why = "The Project has no lint command.";
      pipelines.commands.commandRuns.push([aCommandRun("", "could-not-run", why)]);

      const taskId = await walkStages(pipelines, BY_LINT);

      expect(walkedKeys(await runsOf(pipelines, taskId))).toEqual(["implement"]);
      const [decision] = pipelines.decisions.on(taskId);
      expect(decision?.draft.question).toContain(
        `The condition's command \`lint\` couldn't run: ${why}`,
      );
      expect(decision?.draft.options).toEqual([
        "Go on to Review",
        "Go on to Ship",
        "Drop the Task",
      ]);
      expect((await pipelines.tasks.read(taskId)).state).toBe("waiting-on-you");
    });
  });

  it("weighs a command the fire alarm stopped again once the Task goes on", async () => {
    await using([1, 2], async (pipelines) => {
      const taskId = randomUUID();
      pipelines.commands.runsUntilStopped = true;
      pipelines.commands.observe = (call) => {
        if (call !== "runCommand") return;
        pipelines.commands.observe = undefined;
        void soundTheAlarm(pipelines, taskId);
      };

      await walkStages(pipelines, BY_LINT, taskId);

      expect(walkedKeys(await runsOf(pipelines, taskId))).toEqual(["implement"]);
      expect((await pipelines.tasks.read(taskId)).state).toBe("paused");
      await resume(pipelines, taskId);

      const runs = await runsOf(pipelines, taskId);
      expect(walkedKeys(runs)).toEqual(["implement", "review", "ship"]);
      expect(runs[0]?.commandRuns.map(({ outcome }) => outcome)).toEqual(["stopped", "passed"]);
      expect(conditionsRan(pipelines)).toEqual(["lint", "lint"]);
    });
  });

  it("keeps the result of a command a Pause let end, never running it again on resume", async () => {
    await using([1, 2], async (pipelines) => {
      const taskId = randomUUID();
      pipelines.commands.observe = (call) => {
        if (call !== "runCommand") return;
        pipelines.commands.observe = undefined;
        pipelines.tasks.put(taskId, { state: "paused", pipelineId: "for-tests" });
        void pipelines.app.get(EventBus).publish(new TaskPaused(taskId, "in-progress"));
      };

      await walkStages(pipelines, BY_LINT, taskId);

      expect(walkedKeys(await runsOf(pipelines, taskId))).toEqual(["implement"]);
      await resume(pipelines, taskId);

      expect(walkedKeys(await runsOf(pipelines, taskId))).toEqual(["implement", "review", "ship"]);
      expect(conditionsRan(pipelines)).toEqual(["lint"]);
    });
  });
});
