import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DomainEvent } from "../../../platform/events/domain-event.js";
import { EventBus } from "../../../platform/events/event-bus.js";
import { TaskMovedToProject, TaskPipelineConfirmed } from "../../work/index.js";
import type { Stage } from "../domain/stage.js";
import { TaskStagesReset } from "../domain/task-stages-events.js";
import {
  startPipelinesApplication,
  type PipelinesApplication,
} from "../pipelines-application.fixtures.js";
import { aPerson } from "../ports/pipelines-ports.fixtures.js";
import { PipelineLibrary } from "./pipeline-library.js";
import { TaskStagesService } from "./task-stages-service.js";
import { builtIn, quickFix, withGate, refusalOf } from "./task-stages-service.fixtures.js";

let pipelines: PipelinesApplication;
let service: TaskStagesService;

beforeEach(async () => {
  pipelines = await startPipelinesApplication();
  service = pipelines.app.get(TaskStagesService);
});

afterEach(async () => {
  await pipelines.app.close();
});

function aTask(state = "ready", pipelineId = "quick-fix"): string {
  const taskId = randomUUID();
  pipelines.tasks.put(taskId, { state, pipelineId });
  return taskId;
}

function eventsOf<Event extends DomainEvent>(type: new (...args: never[]) => Event): Event[] {
  return pipelines.published.filter((event): event is Event => event instanceof type);
}

describe("TaskStagesService", () => {
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
  it("leaves the library Pipeline as it is", async () => {
    await service.edit(aTask(), withGate);

    expect((await pipelines.app.get(PipelineLibrary).find("quick-fix"))?.stages).toEqual(quickFix);
  });

  it("refuses a Role whose person only talks, with the reason", async () => {
    pipelines.people.people.set("developer", { card: { ...aPerson().card, taskLimit: "none" } });

    expect(await refusalOf(service.edit(aTask(), quickFix))).toEqual([
      "Stage 1 · Implement: Ada's Task limit is none, so developer only talks and can't work a Stage.",
    ]);
  });

  it("refuses a Role newly named whose engine can't work an Agent Stage, weighed in the Task's Project", async () => {
    const [implement, ...rest] = quickFix;
    if (implement?.kind !== "agent") throw new Error("Quick fix starts with an Agent Stage.");
    pipelines.people.people.set("translator", aPerson());
    pipelines.roleEngines.incapableRoles.add("translator");
    const taskId = randomUUID();
    pipelines.tasks.put(taskId, { state: "ready", pipelineId: "quick-fix", projectId: "billing" });
    const edited: Stage[] = [{ ...implement, role: "translator" }, ...rest];

    expect(await service.check(taskId, edited)).toEqual([
      { text: "The translator's engine can't work an Agent Stage." },
    ]);
    expect(await refusalOf(service.edit(taskId, edited))).toEqual([
      "The translator's engine can't work an Agent Stage.",
    ]);
    expect(pipelines.roleEngines.asked.at(-1)).toEqual({
      roleKeys: ["translator"],
      projectId: "billing",
    });
  });

  it("weighs only Roles neither the library nor the Task's Stages name yet", async () => {
    pipelines.roleEngines.incapableRoles.add("developer");

    expect((await service.edit(aTask(), withGate)).editedForTask).toBe(true);
    expect(pipelines.roleEngines.asked.at(-1)?.roleKeys).toEqual([]);
  });

  it("refuses editing a Task that is done", async () => {
    expect(await refusalOf(service.edit(aTask("done"), withGate))).toEqual([
      "A Task that is done or dropped keeps its Stages.",
    ]);
  });

  it("refuses editing a Task in Shaping", async () => {
    expect(await refusalOf(service.edit(aTask("shaping"), withGate))).toEqual([
      "A Task in Shaping keeps its Stages as they are: confirm its Initiative first.",
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

describe("moving the Task to another Project", () => {
  it("sets the edited Stages aside", async () => {
    const taskId = aTask();
    await service.edit(taskId, withGate);

    await pipelines.app
      .get(EventBus)
      .publish(new TaskMovedToProject(taskId, "admin-panel", "shop", undefined));

    expect(await service.progress(taskId)).toBeUndefined();
    expect(eventsOf(TaskStagesReset)).toMatchObject([{ taskId, pipelineId: "quick-fix" }]);
    expect((await service.make(taskId, "quick-fix")).stages).toEqual(builtIn("quick-fix"));
  });
});
