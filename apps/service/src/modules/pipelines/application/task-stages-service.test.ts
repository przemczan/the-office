import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../test/test-application.js";
import type { DomainEvent } from "../../../platform/events/domain-event.js";
import { EventBus } from "../../../platform/events/event-bus.js";
import { EventsModule } from "../../../platform/events/events.module.js";
import { TaskStarted } from "../../work/index.js";
import { builtInPipelines } from "../domain/built-in-pipelines.js";
import { TaskStagesMade } from "../domain/task-stages-events.js";
import { PipelinesModule } from "../pipelines.module.js";
import { TaskStagesService } from "./task-stages-service.js";

let app: INestApplication;
let published: DomainEvent[];

beforeEach(async () => {
  ({ app } = await startTestApplication({
    database: true,
    imports: [EventsModule, PipelinesModule],
  }));
  published = [];
  app.get(EventBus).subscribeToEveryEvent((event) => void published.push(event));
});

afterEach(async () => {
  await app.close();
});

const quickFix = builtInPipelines.find(({ id }) => id === "quick-fix");

describe("TaskStagesService", () => {
  it("copies the Pipeline's Stages for a Task as it starts", async () => {
    const taskId = randomUUID();

    await app.get(EventBus).publish(new TaskStarted(taskId, "quick-fix"));

    const made = await app.get(TaskStagesService).find(taskId);
    expect(made).toMatchObject({ taskId, pipelineId: "quick-fix", stages: quickFix?.stages });
    const announced = published.filter((event) => event instanceof TaskStagesMade);
    expect(announced).toMatchObject([{ taskId, pipelineId: "quick-fix" }]);
  });

  it("keeps the first copy when the Task starts again", async () => {
    const taskId = randomUUID();
    const service = app.get(TaskStagesService);
    const first = await service.make(taskId, "quick-fix");
    published.length = 0;

    const again = await service.make(taskId, "full");

    expect(again).toEqual(first);
    expect(published).toEqual([]);
  });
});
