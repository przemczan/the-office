import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DomainEvent } from "../../../platform/events/domain-event.js";
import { straightLineFlow } from "../domain/flow.js";
import type { Stage } from "../domain/stage.js";
import type { StagePermissions } from "../domain/stage-permissions.js";
import { aStageRun } from "../domain/stage-run.fixtures.js";
import { TaskStagesEdited, TaskStagesMade } from "../domain/task-stages-events.js";
import {
  startPipelinesApplication,
  type PipelinesApplication,
} from "../pipelines-application.fixtures.js";
import { StageRunRepository } from "../ports/stage-run-repository.js";
import { TaskStagesRepository } from "../ports/task-stages-repository.js";
import { TaskStagesService } from "./task-stages-service.js";
import { quickFix, withGate, refusalOf } from "./task-stages-service.fixtures.js";

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
});

describe("Edit for this Task", () => {
  it("copies a Ready Task's Pipeline and keeps the edit, which Start then walks", async () => {
    const taskId = aTask();

    const progress = await service.edit(taskId, withGate);

    expect(progress.editedForTask).toBe(true);
    expect(progress.stages.map(({ stage }) => stage.key)).toEqual(withGate.map(({ key }) => key));
    expect(eventsOf(TaskStagesEdited)).toMatchObject([{ taskId, pipelineId: "quick-fix" }]);
    expect((await service.make(taskId, "quick-fix")).stages).toEqual(straightLineFlow(withGate));
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
        service.edit(taskId, [{ ...implement, effort: "low" }, ...withGate.slice(1)]),
      ),
    ).toEqual(["Stage 1 · Implement: it has started, so it stays as it is."]);
  });

  it("refuses Stage permissions wider than the Role card's, and keeps those that narrow it", async () => {
    const [implement, ...rest] = quickFix;
    if (implement?.kind !== "agent") throw new Error("Quick fix starts with an Agent Stage.");
    const withPermissions = (permissions: StagePermissions): Stage[] => [
      { ...implement, permissions },
      ...rest,
    ];

    expect(
      await refusalOf(
        service.edit(
          aTask(),
          withPermissions({ run: "anything", mcpTools: { "github/merge": { kind: "allowed" } } }),
        ),
      ),
    ).toEqual([
      "Stage 1 · Implement: the run permission can only be narrowed from the Role card's.",
      "Stage 1 · Implement: the MCP tool github/merge can only be narrowed from the Role card's setting.",
    ]);
    const taskId = aTask();
    const narrowing = withPermissions({
      edit: false,
      mcpTools: { "github/merge": { kind: "never" } },
    });
    await service.edit(taskId, narrowing);
    expect((await service.find(taskId))?.stages).toEqual(straightLineFlow(narrowing));
  });

  it("refuses a Script Stage whose command the Task's Project lacks", async () => {
    pipelines.projects.projects.push({
      id: "test-project",
      name: "Site",
      defaultPipeline: "full",
      commands: [{ key: "build" }, { key: "test" }],
    });
    const fullTests: Stage = {
      kind: "script",
      key: "full",
      name: "Full tests",
      optional: false,
      command: "test-full",
    };

    expect(await refusalOf(service.edit(aTask(), [...quickFix, fullTests]))).toEqual([
      `Stage ${quickFix.length + 1} · Full tests: its Project, Site, has no command test-full.`,
    ]);
  });

  it("leaves a started Stage's permissions and commands unchecked, as it keeps what it ran with", async () => {
    pipelines.projects.projects.push({
      id: "test-project",
      name: "Site",
      defaultPipeline: "full",
      commands: [{ key: "build" }, { key: "test" }],
    });
    const [implement, ...rest] = quickFix;
    if (implement?.kind !== "agent") throw new Error("Quick fix starts with an Agent Stage.");
    const kept: Stage[] = [
      { ...implement, permissions: { run: "anything", commands: ["test-full"] } },
      ...rest,
    ];
    const taskId = aTask("in-progress");
    const own = await service.make(taskId, "quick-fix");
    await pipelines.app.get(TaskStagesRepository).save({ ...own, stages: straightLineFlow(kept) });
    await pipelines.app
      .get(StageRunRepository)
      .saveNew(aStageRun({ id: randomUUID(), taskId, stageKey: "implement" }));

    expect((await service.edit(taskId, kept)).editedForTask).toBe(true);
    expect(await refusalOf(service.edit(aTask(), kept))).toEqual([
      "Stage 1 · Implement: the run permission can only be narrowed from the Role card's.",
      "Stage 1 · Implement: its Project, Site, has no command test-full.",
    ]);
  });
});
