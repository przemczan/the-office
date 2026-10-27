import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { notificationListSchema, type Notification } from "@the-office/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../test/test-application.js";
import { EventBus } from "../../../platform/events/event-bus.js";
import { EventsModule } from "../../../platform/events/events.module.js";
import { EventStreamModule } from "../../../platform/websocket/event-stream.module.js";
import { DecisionAnswered, DecisionOpened } from "../../conversations/index.js";
import { UsageWindowsChanged } from "../../engine/index.js";
import { GateContinued, GateReached } from "../../pipelines/index.js";
import { TaskStateChanged } from "../../work/index.js";
import { NotificationRaised, NotificationsCleared } from "../domain/notification-events.js";
import { NotificationsModule } from "../notifications.module.js";
import {
  AccountUsageForTests,
  DeskLimitForTests,
  NotificationsPortsForTestsModule,
  OfficeStatusCardsForTests,
  OfficeTasksForTests,
  OpenDecisionsForTests,
  TaskStageProgressForTests,
} from "../ports/notifications-ports.fixtures.js";

type DecisionEventParameters = ConstructorParameters<typeof DecisionOpened>;

/** Only what Notifications reads of a Decision: who asks what, on which Task. */
function decisionEvent(
  eventClass: typeof DecisionOpened | typeof DecisionAnswered,
  decision: { readonly id: string; readonly taskId: string; readonly roleKey: string | undefined },
): DecisionOpened {
  const [thread, asked] = [{}, { ...decision, question: "Keep the query string?" }] as unknown as [
    DecisionEventParameters[0],
    DecisionEventParameters[1],
  ];
  return new eventClass(thread, asked, new Date());
}

/** The account's windows as the engine reads them, the 5-hour one this much used. */
function reading(percentUsed: number): UsageWindowsChanged {
  return new UsageWindowsChanged({
    fiveHour: { percentUsed, resetsAt: new Date("2026-10-27T12:00:00Z") },
    sevenDay: { percentUsed: 10, resetsAt: undefined },
  });
}

describe("NotificationService", () => {
  let app: INestApplication;
  let url: string;
  let events: EventBus;
  let raised: NotificationRaised[];
  let cleared: string[];

  beforeEach(async () => {
    ({ app, url } = await startTestApplication({
      database: true,
      imports: [
        EventsModule,
        EventStreamModule,
        NotificationsModule.register({
          imports: [NotificationsPortsForTestsModule],
          officeTasks: OfficeTasksForTests,
          openDecisions: OpenDecisionsForTests,
          taskStageProgress: TaskStageProgressForTests,
          deskLimit: DeskLimitForTests,
          accountUsage: AccountUsageForTests,
          officeStatusCards: OfficeStatusCardsForTests,
        }),
      ],
    }));
    events = app.get(EventBus);
    raised = [];
    cleared = [];
    events.subscribe(NotificationRaised, (event) => void raised.push(event));
    events.subscribe(NotificationsCleared, (event) => void cleared.push(...event.notificationIds));
  });

  afterEach(async () => {
    await app.close();
  });

  async function openNotifications(): Promise<Notification[]> {
    const response = await fetch(`${url}/api/notifications`);
    expect(response.status).toBe(200);
    return notificationListSchema.parse(await response.json());
  }

  async function reportActivity(page: unknown): Promise<void> {
    const response = await fetch(`${url}/api/activity`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ page }),
    });
    expect(response.status).toBe(204);
  }

  it("points at a Decision until it is answered, in its asker's first person", async () => {
    const decision = { id: randomUUID(), taskId: randomUUID(), roleKey: "developer" };

    await events.publish(decisionEvent(DecisionOpened, decision));

    const [notification] = raised.map((event) => event.notification);
    expect(notification).toMatchObject({
      kind: "needs-you.decision",
      roleKey: "developer",
      line: "I need your answer: Keep the query string?",
      pointsTo: { kind: "decision", decisionId: decision.id, taskId: decision.taskId },
      channels: ["in-app", "desktop"],
    });
    expect((await openNotifications()).map(({ id }) => id)).toContain(notification?.id);

    await events.publish(decisionEvent(DecisionAnswered, decision));

    expect(cleared).toEqual([notification?.id]);
    expect((await openNotifications()).map(({ id }) => id)).not.toContain(notification?.id);
  });

  it("raises a Gate once, in the Task's person's words, and clears it when the user acts", async () => {
    const taskId = randomUUID();
    app.get(OfficeTasksForTests).people.set(taskId, "developer");
    app.get(TaskStageProgressForTests).stages.set(taskId, [
      {
        stage: { key: "look", name: "UI acceptance", kind: "gate" },
        state: "waiting-on-you",
        runs: [],
      },
    ]);

    await events.publish(new GateReached(taskId, randomUUID(), "look"));
    await events.publish(new GateReached(taskId, randomUUID(), "look"));
    // Opening the Task doesn't handle a Gate; acting at it does.
    await reportActivity({ kind: "task", taskId });

    expect(raised.map(({ notification }) => notification.line)).toEqual([
      "My work is ready for your look at UI acceptance.",
    ]);
    expect(cleared).toEqual([]);

    await events.publish(new GateContinued(taskId, "look"));

    expect(cleared).toEqual([raised[0]?.notification.id]);
  });

  it("clears a Task's outcome once the user opens the Task", async () => {
    const taskId = randomUUID();

    await events.publish(new TaskStateChanged(taskId, "in-progress", "done"));
    await reportActivity({ kind: "elsewhere" });

    expect(raised.map(({ notification }) => notification)).toEqual([
      expect.objectContaining({
        kind: "outcomes.task-done",
        roleKey: undefined,
        line: "Done.",
        pointsTo: { kind: "task", taskId },
      }),
    ]);
    expect(cleared).toEqual([]);

    await reportActivity({ kind: "task", taskId });

    expect(cleared).toEqual([raised[0]?.notification.id]);
  });

  it("tells the 5-hour window nearly used at 90%, and its reset, which clears that", async () => {
    await events.publish(reading(89));
    await events.publish(reading(91));
    await events.publish(reading(4));

    expect(raised.map(({ notification }) => [notification.kind, notification.channels])).toEqual([
      ["office.window-nearly-used", ["in-app"]],
      ["office.window-reset", ["in-app"]],
    ]);
    expect(cleared).toContain(raised[0]?.notification.id);
  });
});
