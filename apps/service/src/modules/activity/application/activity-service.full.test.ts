import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startTestApplication } from "../../../../test/test-application.js";
import { EventBus } from "../../../platform/events/event-bus.js";
import { EventsModule } from "../../../platform/events/events.module.js";
import { Schedule } from "../../../platform/schedule/schedule.js";
import type { ManualSchedule } from "../../../platform/schedule/schedule.fixtures.js";
import { EventStreamModule } from "../../../platform/websocket/event-stream.module.js";
import { ConnectedDeviceChanged } from "../../devices/index.js";
import { CiRunsChecked } from "../../projects/index.js";
import { TaskStateChanged } from "../../work/index.js";
import { ActivityModule } from "../activity.module.js";
import { ActivityChanged } from "../domain/activity-events.js";
import {
  ACTIVITY_PORTS_FOR_TESTS,
  ActivityCiRunsForTests,
  activityTask,
  ActivityTasksForTests,
} from "../ports/activity-ports.fixtures.js";
import { ActivityService } from "./activity-service.js";

const NOW = new Date("2026-11-21T12:00:00Z");

describe("ActivityService", () => {
  let app: INestApplication;
  let activity: ActivityService;
  let events: EventBus;
  let ciRuns: ActivityCiRunsForTests;
  let announced: ActivityChanged[];
  let projectId: string;

  beforeEach(async () => {
    ({ app } = await startTestApplication({
      database: true,
      imports: [EventsModule, EventStreamModule, ActivityModule.register(ACTIVITY_PORTS_FOR_TESTS)],
    }));
    (app.get(Schedule) as ManualSchedule).setTime(NOW);
    activity = app.get(ActivityService);
    events = app.get(EventBus);
    ciRuns = app.get(ActivityCiRunsForTests);
    announced = [];
    events.subscribe(ActivityChanged, (event) => void announced.push(event));
    // The seen table is shared by every test file, so each test's items are its own.
    projectId = randomUUID();
  });

  afterEach(async () => {
    await app.close();
  });

  function finishedRun(id: number) {
    return {
      id,
      attempt: 1,
      projectId,
      taskId: null,
      workflow: "CI",
      title: "Add a filter",
      status: "succeeded",
      startedAt: new Date("2026-11-21T10:00:00Z"),
      updatedAt: new Date("2026-11-21T11:00:00Z"),
      url: `https://github.com/acme/office/actions/runs/${id}`,
    };
  }

  it("hides an ended item only from the user who saw it", async () => {
    const ann = randomUUID();
    const ben = randomUUID();
    ciRuns.runs = [finishedRun(41), finishedRun(42)];
    const seenId = `ci-run:${projectId}:41:1:ended`;

    await activity.markSeen(ann, [seenId]);

    const ofAnn = await activity.read(ann);
    const ofBen = await activity.read(ben);
    expect(ofAnn.items.map(({ id }) => id)).toEqual([`ci-run:${projectId}:42:1:ended`]);
    expect(ofAnn.count).toBe(1);
    expect(ofBen.items.map(({ id }) => id)).toEqual([seenId, `ci-run:${projectId}:42:1:ended`]);
    expect(ofBen.count).toBe(2);
  });

  it("lists a Task that ended again after its running item was seen", async () => {
    const user = randomUUID();
    const tasks = app.get(ActivityTasksForTests);
    const task = activityTask({ id: randomUUID(), projectId });
    tasks.tasks = [task];
    await activity.markSeen(user, [`task:${task.id}`]);
    expect((await activity.read(user)).items.map(({ id }) => id)).toEqual([`task:${task.id}`]);

    tasks.tasks = [{ ...task, state: "done", endedAt: new Date("2026-11-21T11:30:00Z") }];

    expect((await activity.read(user)).items.map(({ id }) => id)).toEqual([`task:${task.id}:done`]);
  });

  it("forgets what was seen over 30 days ago on the next mark", async () => {
    const user = randomUUID();
    const schedule = app.get(Schedule) as ManualSchedule;
    schedule.setTime(new Date("2026-10-01T12:00:00Z"));
    ciRuns.runs = [finishedRun(41)];
    await activity.markSeen(user, [`ci-run:${projectId}:41:1:ended`]);

    schedule.setTime(NOW);
    await activity.markSeen(user, [`ci-run:${projectId}:99:1:ended`]);

    expect((await activity.read(user)).items.map(({ id }) => id)).toEqual([
      `ci-run:${projectId}:41:1:ended`,
    ]);
  });

  it("announces ActivityChanged once a user marks items seen", async () => {
    await activity.markSeen(randomUUID(), ["ci-run:office:41:1:ended"]);

    await vi.waitFor(() => expect(announced).toHaveLength(1));
  });

  it("announces ActivityChanged on a change of a source", async () => {
    await events.publish(new ConnectedDeviceChanged(randomUUID(), randomUUID()));
    await vi.waitFor(() => expect(announced).toHaveLength(1));

    await events.publish(new TaskStateChanged(randomUUID(), "ready", "in-progress"));

    await vi.waitFor(() => expect(announced).toHaveLength(2));
  });

  it("announces a burst of changes once, and once more for those that came meanwhile", async () => {
    await Promise.all([
      events.publish(new CiRunsChecked([projectId], NOW)),
      events.publish(new CiRunsChecked([projectId], NOW)),
      events.publish(new CiRunsChecked([projectId], NOW)),
    ]);
    await vi.waitFor(() => expect(announced).toHaveLength(2));
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(announced).toHaveLength(2);
  });
});
