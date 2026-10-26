import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DomainEvent } from "../../../platform/events/domain-event.js";
import { EventBus } from "../../../platform/events/event-bus.js";
import { TaskPipelineConfirmed } from "../../work/index.js";
import { builtInPipelines } from "../domain/built-in-pipelines.js";
import type { Stage } from "../domain/stage.js";
import { gate } from "../domain/stage.fixtures.js";
import { aStageRun } from "../domain/stage-run.fixtures.js";
import { StagesEditRefused } from "../domain/stages-edit-refused.js";
import { TaskStagesEdited, TaskStagesMade, TaskStagesReset } from "../domain/task-stages-events.js";
import {
  startPipelinesApplication,
  type PipelinesApplication,
} from "../pipelines-application.fixtures.js";
import { aPerson } from "../ports/pipelines-ports.fixtures.js";
import { StageRunRepository } from "../ports/stage-run-repository.js";
import { PipelineLibrary } from "./pipeline-library.js";
import { TaskStagesService } from "./task-stages-service.js";

let pipelines: PipelinesApplication;
let service: TaskStagesService;

beforeEach(async () => {
  pipelines = await startPipelinesApplication();
  service = pipelines.app.get(TaskStagesService);
});

afterEach(async () => {
  await pipelines.app.close();
});

function builtIn(id: string): readonly Stage[] {
  const pipeline = builtInPipelines.find((each) => each.id === id);
  if (!pipeline) throw new Error(`No built-in Pipeline ${id}.`);
  return pipeline.stages;
}

const quickFix = builtIn("quick-fix");
const withGate: readonly Stage[] = [
  ...quickFix.slice(0, -1),
  gate({ key: "look", name: "Look" }),
  ...quickFix.slice(-1),
];

function aTask(state = "ready", pipelineId = "quick-fix"): string {
  const taskId = randomUUID();
  pipelines.tasks.put(taskId, { state, pipelineId });
  return taskId;
}

function eventsOf<Event extends DomainEvent>(type: new (...args: never[]) => Event): Event[] {
  return pipelines.published.filter((event): event is Event => event instanceof type);
}

async function refusalOf(work: Promise<unknown>): Promise<readonly string[]> {
  const error: unknown = await work.then(
    () => undefined,
    (thrown: unknown) => thrown,
  );
  if (!(error instanceof StagesEditRefused)) throw new Error("The edit wasn't refused.");
  return error.problems.map(({ text }) => text);
}

describe("TaskStagesService", () => {
  it("copies the Pipeline's Stages for a Task", async () => {
    const taskId = aTask("in-progress");

    await service.make(taskId, "quick-fix");

    expect(await service.find(taskId)).toMatchObject({
      taskId,
      pipelineId: "quick-fix",
      stages: quickFix,
      editedForTask: false,
    });
    expect(eventsOf(TaskStagesMade)).toMatchObject([{ taskId, pipelineId: "quick-fix" }]);
  });

  it("keeps the Task's copy when it starts again", async () => {
    const taskId = aTask("in-progress");
    const first = await service.make(taskId, "quick-fix");
    pipelines.published.length = 0;

    expect(await service.make(taskId, "quick-fix")).toEqual(first);
    expect(pipelines.published).toEqual([]);
  });

  it("is nothing for a Task that follows its library Pipeline", async () => {
    expect(await service.progress(aTask())).toBeUndefined();
  });
});

describe("Edit for this Task", () => {
  it("copies a Ready Task's Pipeline and keeps the edit, which Start then walks", async () => {
    const taskId = aTask();

    const progress = await service.edit(taskId, withGate);

    expect(progress.editedForTask).toBe(true);
    expect(progress.stages.map(({ stage }) => stage.key)).toEqual(withGate.map(({ key }) => key));
    expect(eventsOf(TaskStagesEdited)).toMatchObject([{ taskId, pipelineId: "quick-fix" }]);
    expect((await service.make(taskId, "quick-fix")).stages).toEqual(withGate);
  });

  it("leaves the library Pipeline as it is", async () => {
    await service.edit(aTask(), withGate);

    expect((await pipelines.app.get(PipelineLibrary).find("quick-fix"))?.stages).toEqual(quickFix);
  });

  it("changes a running Task's Stages after the started ones, and refuses changing those", async () => {
    const taskId = aTask("in-progress");
    await service.make(taskId, "quick-fix");
    await pipelines.app.get(StageRunRepository).saveNew(
      aStageRun({
        id: randomUUID(),
        taskId,
        stageKey: "implement",
        outcome: undefined,
        endedAt: undefined,
      }),
    );
    const [implement] = quickFix;
    if (implement?.kind !== "agent") throw new Error("Quick fix starts with an Agent Stage.");

    expect((await service.edit(taskId, withGate)).editedForTask).toBe(true);
    expect(
      await refusalOf(
        service.edit(taskId, [{ ...implement, model: "claude-haiku-5-5" }, ...withGate.slice(1)]),
      ),
    ).toEqual(["Stage 1 · Implement: it has started, so it stays as it is, where it is."]);
  });

  it("refuses a Role whose person only talks, with the reason", async () => {
    pipelines.people.people.set("developer", { card: { ...aPerson().card, taskLimit: "none" } });

    expect(await refusalOf(service.edit(aTask(), quickFix))).toEqual([
      "Stage 1 · Implement: Ada's Task limit is none, so developer only talks and can't work a Stage.",
    ]);
  });

  it("refuses editing a Task that is done", async () => {
    expect(await refusalOf(service.edit(aTask("done"), withGate))).toEqual([
      "A Task that is done or dropped keeps its Stages.",
    ]);
  });
});

describe("swapping the Pipeline before Start", () => {
  it("sets the edited Stages aside: the Task follows the new Pipeline", async () => {
    const taskId = aTask();
    await service.edit(taskId, withGate);

    pipelines.tasks.put(taskId, { state: "ready", pipelineId: "full" });
    await pipelines.app.get(EventBus).publish(new TaskPipelineConfirmed(taskId, "full"));

    expect(await service.progress(taskId)).toBeUndefined();
    expect(eventsOf(TaskStagesReset)).toMatchObject([{ taskId, pipelineId: "quick-fix" }]);
    expect((await service.make(taskId, "full")).stages).toEqual(builtIn("full"));
  });

  it("starts with the new Pipeline even when the copy wasn't set aside", async () => {
    const taskId = aTask();
    await service.edit(taskId, withGate);
    pipelines.tasks.put(taskId, { state: "in-progress", pipelineId: "full" });

    expect(await service.find(taskId)).toBeUndefined();
    expect(await service.make(taskId, "full")).toMatchObject({
      stages: builtIn("full"),
      editedForTask: false,
    });
  });
});
