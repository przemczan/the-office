import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startTestApplication } from "../../../../test/test-application.js";
import { EventBus } from "../../../platform/events/event-bus.js";
import { EventsModule } from "../../../platform/events/events.module.js";
import { Schedule } from "../../../platform/schedule/schedule.js";
import type { ManualSchedule } from "../../../platform/schedule/schedule.fixtures.js";
import { EventStreamModule } from "../../../platform/websocket/event-stream.module.js";
import { MessagesLogged } from "../../conversations/index.js";
import { ConnectedDeviceChanged } from "../../devices/index.js";
import { CiRunsChecked } from "../../projects/index.js";
import { TaskStateChanged } from "../../work/index.js";
import { ActivityModule } from "../activity.module.js";
import { ActivityChanged } from "../domain/activity-events.js";
import {
  ACTIVITY_PORTS_FOR_TESTS,
  ActivityCiRunsForTests,
  ActivityInitiativesForTests,
  ActivitySessionsForTests,
  activityTask,
  ActivityTasksForTests,
} from "../ports/activity-ports.fixtures.js";
import { ActivityService } from "./activity-service.js";

const NOW = new Date("2026-11-21T12:00:00Z");

/** A Thread as the events carry it; Activity reads only its id, state and open Decisions. */
function threadIn(id: string, state: "waiting" | "answering"): never {
  return { id, state, openDecisions: [] } as never;
}

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
    projectId = randomUUID();
  });

  afterEach(async () => {
    await app.close();
  });

  function runningRun(id: number) {
    return {
      id,
      attempt: 1,
      projectId,
      taskId: null,
      workflow: "CI",
      title: "Add a filter",
      status: "running",
      startedAt: new Date("2026-11-21T10:00:00Z"),
      updatedAt: new Date("2026-11-21T11:00:00Z"),
      url: `https://github.com/acme/office/actions/runs/${id}`,
    };
  }

  it("reads the sessions of the user it is read for, grouped on their Task", async () => {
    const task = activityTask({ id: randomUUID(), projectId });
    app.get(ActivityTasksForTests).tasks = [task];
    app.get(ActivitySessionsForTests).sessions = [
      {
        threadId: randomUUID(),
        roleKey: "developer",
        subject: { kind: "task", taskId: task.id },
        sessionKind: "stage",
        state: "working",
        waitingOn: undefined,
        since: NOW,
      },
    ];

    const read = await activity.read(randomUUID());

    expect(read.activities).toHaveLength(1);
    expect(read.activities[0]?.subject).toMatchObject({ kind: "task", title: task.title });
    expect(read.count).toBe(1);
  });

  it("lists the Initiative of a session by its title", async () => {
    const initiativeId = randomUUID();
    app.get(ActivityInitiativesForTests).titles.set(initiativeId, "Revamp Activity");
    app.get(ActivitySessionsForTests).sessions = [
      {
        threadId: randomUUID(),
        roleKey: "planner",
        subject: { kind: "initiative", initiativeId },
        sessionKind: "thread",
        state: "waiting",
        waitingOn: { kind: "decision", question: "Which way?" },
        since: NOW,
      },
    ];

    const read = await activity.read(randomUUID());

    expect(read.activities[0]?.subject).toMatchObject({
      kind: "initiative",
      title: "Revamp Activity",
    });
  });

  it("lists only the running CI runs, and counts them", async () => {
    ciRuns.runs = [
      { ...runningRun(41), status: "running" },
      { ...runningRun(42), status: "succeeded" },
    ];

    const read = await activity.read(randomUUID());

    expect(read.otherWork.map(({ id }) => id)).toEqual([`ci-run:${projectId}:41:1`]);
    expect(read.count).toBe(1);
  });

  it("announces ActivityChanged when a Thread starts or stops being busy, not for every message", async () => {
    const id = randomUUID();
    await events.publish(new MessagesLogged(threadIn(id, "answering"), [], NOW, false));
    await vi.waitFor(() => expect(announced).toHaveLength(1));

    await events.publish(new MessagesLogged(threadIn(id, "answering"), [], NOW, false));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(announced).toHaveLength(1);

    await events.publish(new MessagesLogged(threadIn(id, "waiting"), [], NOW, false));
    await vi.waitFor(() => expect(announced).toHaveLength(2));
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
