import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { EventBus } from "../../../platform/events/event-bus.js";
import type { SessionScript } from "../../engine/index.js";
import { TaskStarted } from "../../work/index.js";
import type { OnFailure, Stage } from "../domain/stage.js";
import {
  NoRetriesLeft,
  PipelineCompleted,
  StageRunEnded,
  StageRunStarted,
  WentBackToStage,
} from "../domain/stage-run-events.js";
import {
  A_WAITING_RESULT,
  aDoneResult,
  anAgentSession,
  anAgentStage,
  anAskedDecision,
  asksOnce,
  runsOf,
  startPipelinesApplication,
  walkStages,
  type PipelinesApplication,
} from "../pipelines-application.fixtures.js";
import { aCommandRun } from "../ports/pipelines-ports.fixtures.js";
import { TaskStagesRepository } from "../ports/task-stages-repository.js";
import { StageInterpreter } from "./stage-interpreter.js";

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

const agentDone = anAgentSession(aDoneResult());

let pipelines: PipelinesApplication;

afterEach(async () => {
  await pipelines.app.close();
});

/**
 * The Pipelines module, its Agent Stages' sessions replaying `scripts` in order; its Script
 * Stages' commands pass unless a test puts what they print as they fail.
 */
async function startWith(...scripts: SessionScript[]): Promise<void> {
  pipelines = await startPipelinesApplication(scripts);
}

/** The next Script Stages' commands fail, printing these, in order. */
function failing(...printed: string[]): void {
  pipelines.commands.commandRuns.push(
    ...printed.map((output) => [aCommandRun("npm test", "failed", output)]),
  );
}

/** Runs while the next Script Stage's command runs, such as dropping the Task meanwhile. */
function meanwhile(act: () => void): void {
  pipelines.commands.observe = (call) => {
    if (call === "runCommand") act();
  };
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
    failing("2 tests fail.", "1 test fails.");

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
    const works = pipelines.stageThreads.requests.map(({ work }) => work);
    expect(works.map((work) => work.includes("Why this Stage runs again"))).toEqual([
      false,
      true,
      true,
    ]);
    expect(works[1]).toContain("2 tests fail.");
    expect(works[2]).toContain("1 test fails.");
    expect(walkEvents()).toContainEqual(["went back", "measure", "draft", 2, 2]);
    const runs = await runsOf(pipelines, taskId);
    expect(runs[2]?.carriedFailure).toEqual({
      stageKey: "measure",
      error: expect.stringContaining("2 tests fail."),
      round: 1,
      rounds: 2,
    });
    expect(pipelines.tasks.changes).toEqual([{ taskId, state: "done" }]);
  });

  it("stops with no retries left and the Task waits on the user", async () => {
    await startWith(agentDone, agentDone);
    failing("2 tests fail.", "Still 2.");

    const taskId = await walk([
      agentStage("draft"),
      scriptStage("measure", { goBackTo: "draft", rounds: 1 }),
    ]);

    expect(await statusesOf(taskId)).toHaveLength(4);
    expect(walkEvents().slice(-2)).toEqual([
      ["ended", "measure", "failed"],
      ["no retries left", "measure", expect.stringContaining("Still 2.")],
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
    await startWith(anAgentSession(A_WAITING_RESULT));
    asksOnce(pipelines, anAskedDecision());

    const taskId = await walk([agentStage("draft"), scriptStage("measure")]);

    expect(await statusesOf(taskId)).toEqual([["draft", "needs-decision"]]);
    expect(pipelines.tasks.changes).toEqual([{ taskId, state: "waiting-on-you" }]);
    expect(walkEvents()).not.toContainEqual(expect.arrayContaining(["no retries left"]));
  });

  it("stops where the runs stand once the Task is no longer In progress", async () => {
    await startWith();
    const taskId = randomUUID();
    meanwhile(() => pipelines.tasks.put(taskId, { state: "dropped", pipelineId: "for-tests" }));

    await walk([scriptStage("measure"), agentStage("draft")], taskId);

    expect(await statusesOf(taskId)).toEqual([["measure", "done"]]);
    expect(pipelines.tasks.changes).toEqual([]);
  });

  it("walks a Task as it starts, on its own copy of its Pipeline's Stages", async () => {
    await startWith(agentDone);
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
    expect(pipelines.publishing.published.map(({ taskId: published }) => published)).toEqual([
      taskId,
    ]);
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
    const interpreter = pipelines.app.get(StageInterpreter);
    meanwhile(() => void interpreter.onModuleDestroy());

    const taskId = await walk([scriptStage("measure"), scriptStage("lint")]);

    expect(await statusesOf(taskId)).toEqual([["measure", "done"]]);
    expect(pipelines.tasks.changes).toEqual([]);
  });
});
