import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { EventBus } from "../../../platform/events/event-bus.js";
import type { SessionScript } from "../../engine/index.js";
import { TaskStarted } from "../../work/index.js";
import type { OnFailure, Stage } from "../domain/stage.js";
import type { StageOutcome } from "../domain/stage-run.js";
import {
  NoRetriesLeft,
  PipelineCompleted,
  StageRunEnded,
  StageRunStarted,
  WentBackToStage,
} from "../domain/stage-run-events.js";
import {
  aDoneResult,
  anAgentSession,
  anAgentStage,
  runsOf,
  startPipelinesApplication,
  walkStages,
  type PipelinesApplication,
} from "../pipelines-application.fixtures.js";
import { TaskStagesRepository } from "../ports/task-stages-repository.js";
import { StageInterpreter } from "./stage-interpreter.js";
import type { StageRunner, StageWork } from "./stage-runner.js";
import { StageRunners } from "./stage-runners.js";

/** A Script Stage that ends as the test says, in order. */
class ScriptStageRunnerForTests implements StageRunner<"script"> {
  readonly outcomes: StageOutcome[] = [];
  /** Runs while the Stage runs, such as dropping the Task meanwhile. */
  meanwhile: () => void = () => undefined;

  async run({ stage }: StageWork<"script">): Promise<StageOutcome> {
    this.meanwhile();
    const outcome = this.outcomes.shift();
    if (!outcome) throw new Error(`No outcome is left for Script Stage "${stage.key}".`);
    return outcome;
  }
}

function agentStage(key: string, onFailure?: OnFailure): Stage {
  return anAgentStage(key, onFailure && { onFailure });
}

function scriptStage(key: string, onFailure?: OnFailure): Stage {
  return {
    kind: "script",
    key,
    name: key,
    optional: false,
    command: "test",
    ...(onFailure && { onFailure }),
  };
}

const done: StageOutcome = { status: "done", summary: "Done." };
const agentDone = anAgentSession(aDoneResult());

let pipelines: PipelinesApplication;
let scriptRunner: ScriptStageRunnerForTests;

afterEach(async () => {
  await pipelines.app.close();
});

/** The Pipelines module, its Agent Stages' sessions replaying `scripts` in order. */
async function startWith(...scripts: SessionScript[]): Promise<void> {
  await startWithoutScriptStages(scripts);
  scriptRunner = new ScriptStageRunnerForTests();
  pipelines.app.get(StageRunners).register("script", scriptRunner);
}

/** The Pipelines module as production has it until Script Stages come. */
async function startWithoutScriptStages(scripts: readonly SessionScript[] = []): Promise<void> {
  pipelines = await startPipelinesApplication(scripts);
}

function walk(stages: readonly Stage[], taskId?: string): Promise<string> {
  return walkStages(pipelines, stages, taskId);
}

async function statusesOf(taskId: string): Promise<[string, string | undefined][]> {
  const runs = await runsOf(pipelines, taskId);
  return runs.map(({ stageKey, outcome }) => [stageKey, outcome?.status]);
}

/** What the walk announced, as each event's class and the fields that tell them apart. */
function walkEvents(): unknown[] {
  return pipelines.published.flatMap((event) => {
    if (event instanceof StageRunStarted) return [["started", event.stageKey]];
    if (event instanceof StageRunEnded) return [["ended", event.stageKey, event.status]];
    if (event instanceof WentBackToStage) {
      return [["went back", event.fromStageKey, event.toStageKey, event.round, event.rounds]];
    }
    if (event instanceof NoRetriesLeft) return [["no retries left", event.stageKey, event.error]];
    if (event instanceof PipelineCompleted) return [["completed"]];
    return [];
  });
}

describe("StageInterpreter", () => {
  it("walks a Pipeline of arbitrary Stages to the end and the Task to Done", async () => {
    await startWith(agentDone, agentDone);
    scriptRunner.outcomes.push(done);

    const taskId = await walk([agentStage("draft"), scriptStage("measure"), agentStage("proof")]);

    expect(await statusesOf(taskId)).toEqual([
      ["draft", "done"],
      ["measure", "done"],
      ["proof", "done"],
    ]);
    expect(walkEvents()).toEqual([
      ["started", "draft"],
      ["ended", "draft", "done"],
      ["started", "measure"],
      ["ended", "measure", "done"],
      ["started", "proof"],
      ["ended", "proof", "done"],
      ["completed"],
    ]);
    expect(pipelines.tasks.changes).toEqual([{ taskId, state: "done" }]);
  });

  it("goes back on failure, with the error in the next Brief, as many times as the loop may", async () => {
    await startWith(agentDone, agentDone, agentDone);
    scriptRunner.outcomes.push(
      { status: "failed", error: "2 tests fail." },
      { status: "failed", error: "1 test fails." },
      done,
    );

    const taskId = await walk([
      agentStage("draft"),
      scriptStage("measure", { goBackTo: "draft", rounds: 2 }),
    ]);

    expect(await statusesOf(taskId)).toEqual([
      ["draft", "done"],
      ["measure", "failed"],
      ["draft", "done"],
      ["measure", "failed"],
      ["draft", "done"],
      ["measure", "done"],
    ]);
    const carried = pipelines.stageThreads.requests.map(({ work }) => work.split("\n\n").at(-1));
    expect(carried).toEqual(["Do draft.", "2 tests fail.", "1 test fails."]);
    expect(walkEvents()).toContainEqual(["went back", "measure", "draft", 2, 2]);
    const runs = await runsOf(pipelines, taskId);
    expect(runs[2]?.carriedFailure).toEqual({
      stageKey: "measure",
      error: "2 tests fail.",
      round: 1,
      rounds: 2,
    });
    expect(pipelines.tasks.changes).toEqual([{ taskId, state: "done" }]);
  });

  it("stops with no retries left and the Task waits on the user", async () => {
    await startWith(agentDone, agentDone);
    scriptRunner.outcomes.push(
      { status: "failed", error: "2 tests fail." },
      { status: "failed", error: "Still 2." },
    );

    const taskId = await walk([
      agentStage("draft"),
      scriptStage("measure", { goBackTo: "draft", rounds: 1 }),
    ]);

    expect(await statusesOf(taskId)).toHaveLength(4);
    expect(walkEvents().slice(-2)).toEqual([
      ["ended", "measure", "failed"],
      ["no retries left", "measure", "Still 2."],
    ]);
    expect(pipelines.tasks.changes).toEqual([{ taskId, state: "waiting-on-you" }]);
  });

  it("stops at a failed Stage without a loop", async () => {
    await startWith(
      anAgentSession({
        status: "failed",
        summary: "Stopped.",
        failureReason: "The page isn't there.",
      }),
    );

    const taskId = await walk([agentStage("draft"), scriptStage("measure")]);

    expect(await statusesOf(taskId)).toEqual([["draft", "failed"]]);
    expect(walkEvents()).toContainEqual(["no retries left", "draft", "The page isn't there."]);
    expect(pipelines.tasks.changes).toEqual([{ taskId, state: "waiting-on-you" }]);
  });

  it("waits on the user when a Stage needs a Decision", async () => {
    await startWith(
      anAgentSession({
        status: "needs_decision",
        summary: "Asked which page.",
        decision: {
          question: "Which page?",
          context: "Both list devices.",
          options: ["The device page", "The list"],
          recommendation: { option: 0, reason: "It has the room." },
        },
      }),
    );

    const taskId = await walk([agentStage("draft"), scriptStage("measure")]);

    expect(await statusesOf(taskId)).toEqual([["draft", "needs-decision"]]);
    expect(pipelines.tasks.changes).toEqual([{ taskId, state: "waiting-on-you" }]);
    expect(walkEvents()).not.toContainEqual(expect.arrayContaining(["no retries left"]));
  });

  it("fails a Stage of a kind it can't run yet, with the reason", async () => {
    await startWithoutScriptStages();
    const taskId = await walk([scriptStage("measure")]);

    expect(walkEvents()).toEqual([
      ["started", "measure"],
      ["ended", "measure", "failed"],
      ["no retries left", "measure", "The Office can't run this Script Stage yet."],
    ]);
    expect(pipelines.tasks.changes).toEqual([{ taskId, state: "waiting-on-you" }]);
  });

  it("stops where the runs stand once the Task is no longer In progress", async () => {
    await startWith();
    const taskId = randomUUID();
    scriptRunner.outcomes.push(done);
    scriptRunner.meanwhile = () =>
      pipelines.tasks.put(taskId, { state: "dropped", pipelineId: "for-tests" });

    await walk([scriptStage("measure"), agentStage("draft")], taskId);

    expect(await statusesOf(taskId)).toEqual([["measure", "done"]]);
    expect(pipelines.tasks.changes).toEqual([]);
  });

  it("walks a Task as it starts, on its own copy of its Pipeline's Stages", async () => {
    await startWith(agentDone);
    scriptRunner.outcomes.push(done, done);
    const taskId = randomUUID();
    pipelines.tasks.put(taskId, { state: "in-progress", pipelineId: "quick-fix" });

    await pipelines.app.get(EventBus).publish(new TaskStarted(taskId, "quick-fix"));
    await pipelines.app.get(StageInterpreter).walked(taskId);

    expect(await pipelines.app.get(TaskStagesRepository).find(taskId)).toMatchObject({
      pipelineId: "quick-fix",
    });
    expect(await statusesOf(taskId)).toEqual([
      ["implement", "done"],
      ["tests", "done"],
      ["publish", "done"],
    ]);
    expect(pipelines.tasks.changes).toEqual([{ taskId, state: "done" }]);
  });

  it("makes the Task's own Stages when the copy made as it started is missing", async () => {
    await startWith(
      anAgentSession({ status: "failed", summary: "Stopped.", failureReason: "Stopped here." }),
    );
    const taskId = randomUUID();
    pipelines.tasks.put(taskId, { state: "in-progress", pipelineId: "quick-fix" });

    pipelines.app.get(StageInterpreter).walkInBackground(taskId);
    await pipelines.app.get(StageInterpreter).walked(taskId);

    expect(await pipelines.app.get(TaskStagesRepository).find(taskId)).toMatchObject({
      pipelineId: "quick-fix",
    });
    expect(await statusesOf(taskId)).toEqual([["implement", "failed"]]);
  });

  it("starts no other Stage once the service stops", async () => {
    await startWith();
    scriptRunner.outcomes.push(done);
    const interpreter = pipelines.app.get(StageInterpreter);
    scriptRunner.meanwhile = () => void interpreter.onModuleDestroy();

    const taskId = await walk([scriptStage("measure"), scriptStage("lint")]);

    expect(await statusesOf(taskId)).toEqual([["measure", "done"]]);
    expect(pipelines.tasks.changes).toEqual([]);
  });
});
