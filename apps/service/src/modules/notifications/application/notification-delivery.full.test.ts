import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import {
  notificationListSchema,
  type Notification as NotificationResponse,
} from "@the-office/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../test/test-application.js";
import { EventBus } from "../../../platform/events/event-bus.js";
import { EventsModule } from "../../../platform/events/events.module.js";
import { Schedule } from "../../../platform/schedule/schedule.js";
import { ManualSchedule } from "../../../platform/schedule/schedule.fixtures.js";
import { EventStreamModule } from "../../../platform/websocket/event-stream.module.js";
import { DecisionAnswered, DecisionOpened } from "../../conversations/index.js";
import { EngineDown } from "../../engine/index.js";
import { TaskStateChanged } from "../../work/index.js";
import { RecordingPhonePush } from "../adapters/phone/recording-phone-push.js";
import type { Notification } from "../domain/notification.js";
import { NotificationRaised, NotificationsCleared } from "../domain/notification-events.js";
import { DEFAULT_TIMING } from "../domain/notification-timing.js";
import { NotificationsModule } from "../notifications.module.js";
import {
  NotificationsForTests,
  NotificationTimingForTests,
  UserActivityForTests,
} from "../ports/delivery.fixtures.js";
import { NotificationRepository } from "../ports/notification-repository.js";
import { NotificationTimingRepository } from "../ports/notification-timing-repository.js";
import {
  AccountUsageForTests,
  DeskLimitForTests,
  KnownPeopleForTests,
  NotificationsPortsForTestsModule,
  OfficeFireAlarmForTests,
  OfficeStatusCardsForTests,
  ResumePlansForTests,
  OfficeInitiativesForTests,
  OfficeTasksForTests,
  OpenDecisionsForTests,
  StartQueueForTests,
  TaskStageProgressForTests,
} from "../ports/notifications-ports.fixtures.js";
import { PhonePush } from "../ports/phone-push.js";
import { UserActivityRepository } from "../ports/user-activity-repository.js";

type DecisionEventParameters = ConstructorParameters<typeof DecisionOpened>;

function decisionEvent(
  eventClass: typeof DecisionOpened | typeof DecisionAnswered,
  decision: { readonly id: string; readonly taskId: string },
): DecisionOpened {
  const [thread, asked] = [
    { home: { kind: "task" } },
    {
      ...decision,
      roleKey: "developer",
      questions: [{ kind: "open", question: "Keep the query string?" }],
    },
  ] as unknown as [DecisionEventParameters[0], DecisionEventParameters[1]];
  return new eventClass(thread, asked, new Date());
}

/**
 * Each test keeps its Notifications, the timing and the user's activity in fixtures of its own,
 * apart from the other files', and runs on a day of its own.
 */
let testDay = 0;

describe("NotificationDelivery", () => {
  let app: INestApplication;
  let url: string;
  let events: EventBus;
  let schedule: ManualSchedule;
  let notifications: NotificationsForTests;
  let timing: NotificationTimingForTests;
  let activity: UserActivityForTests;
  let raised: NotificationRaised[];
  let cleared: string[];

  /** Noon of this test's day, plus some minutes. */
  let noon: (minutes?: number) => Date;

  async function start(): Promise<void> {
    ({ app, url } = await startTestApplication({
      database: true,
      imports: [
        EventsModule,
        EventStreamModule,
        NotificationsModule.register({
          imports: [NotificationsPortsForTestsModule],
          officeTasks: OfficeTasksForTests,
          officeInitiatives: OfficeInitiativesForTests,
          openDecisions: OpenDecisionsForTests,
          taskStageProgress: TaskStageProgressForTests,
          deskLimit: DeskLimitForTests,
          startQueue: StartQueueForTests,
          knownPeople: KnownPeopleForTests,
          accountUsage: AccountUsageForTests,
          officeStatusCards: OfficeStatusCardsForTests,
          officeFireAlarm: OfficeFireAlarmForTests,
          resumePlans: ResumePlansForTests,
        }),
      ],
      overrides: [
        { provide: Schedule, useValue: schedule },
        { provide: NotificationRepository, useValue: notifications },
        { provide: NotificationTimingRepository, useValue: timing },
        { provide: UserActivityRepository, useValue: activity },
      ],
    }));
    events = app.get(EventBus);
    raised = [];
    cleared = [];
    events.subscribe(NotificationRaised, (event) => void raised.push(event));
    events.subscribe(NotificationsCleared, (event) => void cleared.push(...event.notificationIds));
  }

  beforeEach(async () => {
    testDay += 1;
    const day = testDay;
    noon = (minutes = 0) => new Date(2100, 0, day, 12, minutes);
    schedule = new ManualSchedule();
    schedule.setTime(noon());
    notifications = new NotificationsForTests();
    timing = new NotificationTimingForTests();
    activity = new UserActivityForTests();
    await start();
  });

  afterEach(async () => {
    await app.close();
  });

  /** What went to the phone in this test. */
  function pushedToPhone(ids: readonly (string | undefined)[]): string[] {
    const recorded = app.get(PhonePush) as RecordingPhonePush;
    return recorded.pushed.map(({ id }) => id).filter((id) => ids.includes(id));
  }

  function raisedNotifications(): Notification[] {
    return raised.map(({ notification }) => notification);
  }

  async function reportActivity(): Promise<void> {
    const response = await fetch(`${url}/api/activity`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ page: { kind: "elsewhere" } }),
    });
    expect(response.status).toBe(204);
  }

  async function openTask(taskId: string): Promise<void> {
    const response = await fetch(`${url}/api/activity`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ page: { kind: "task", taskId } }),
    });
    expect(response.status).toBe(204);
  }

  async function listed(): Promise<NotificationResponse[]> {
    const response = await fetch(`${url}/api/notifications`);
    expect(response.status).toBe(200);
    return notificationListSchema.parse(await response.json());
  }

  describe("the phone", () => {
    it("waits while the user is at the desk, and goes once the hold and the away delay pass, unless handled", async () => {
      await reportActivity();
      const [kept, answered] = [
        { id: randomUUID(), taskId: randomUUID() },
        { id: randomUUID(), taskId: randomUUID() },
      ];
      await schedule.advanceTo(noon(1));
      await events.publish(decisionEvent(DecisionOpened, kept));
      await events.publish(decisionEvent(DecisionOpened, answered));
      const ids = raisedNotifications().map(({ id }) => id);

      await schedule.advanceTo(noon(9));
      expect(pushedToPhone(ids)).toEqual([]);
      await events.publish(decisionEvent(DecisionAnswered, answered));

      // Five minutes' hold since the last activity at noon, then five away.
      await schedule.advanceTo(noon(10));
      expect(pushedToPhone(ids)).toEqual([ids[0]]);
    });

    it("waits longer when the user comes back meanwhile", async () => {
      await reportActivity();
      await events.publish(
        decisionEvent(DecisionOpened, { id: randomUUID(), taskId: randomUUID() }),
      );
      const ids = raisedNotifications().map(({ id }) => id);

      await schedule.advanceTo(noon(4));
      await reportActivity();
      await schedule.advanceTo(noon(13));
      expect(pushedToPhone(ids)).toEqual([]);
      await schedule.advanceTo(noon(14));

      expect(pushedToPhone(ids)).toEqual(ids);
    });

    it("goes at once once the user has been away long enough, and only where the routing sends it", async () => {
      await reportActivity();
      await schedule.advanceTo(noon(30));
      await events.publish(
        decisionEvent(DecisionOpened, { id: randomUUID(), taskId: randomUUID() }),
      );
      // Done goes in-app and to the desktop only, by ticket 20's defaults.
      await events.publish(new TaskStateChanged(randomUUID(), "in-progress", "done"));
      const ids = raisedNotifications().map(({ id }) => id);

      expect(pushedToPhone(ids)).toEqual([ids[0]]);
    });

    it("waits again after a restart", async () => {
      await reportActivity();
      await events.publish(
        decisionEvent(DecisionOpened, { id: randomUUID(), taskId: randomUUID() }),
      );
      const ids = raisedNotifications().map(({ id }) => id);
      await app.close();

      schedule = new ManualSchedule();
      schedule.setTime(noon(2));
      await start();
      await schedule.advanceTo(noon(10));

      expect(pushedToPhone(ids)).toEqual(ids);
    });
  });

  describe("quiet hours", () => {
    beforeEach(() => {
      timing.timing = { ...DEFAULT_TIMING, quietHours: { from: "22:00", to: "07:00" } };
    });

    it("hold the desktop and the phone, let an Agent engine down through, and end in one summary", async () => {
      const decision = { id: randomUUID(), taskId: randomUUID() };
      await schedule.advanceTo(new Date(2100, 0, testDay, 23, 30));
      await events.publish(decisionEvent(DecisionOpened, decision));
      await events.publish(
        new EngineDown("s1", "claude-code", "Claude Code", "Claude Code didn't start."),
      );
      const [waiting, down] = raisedNotifications();

      expect(waiting).toMatchObject({
        channels: ["in-app", "desktop", "phone"],
        held: ["desktop", "phone"],
      });
      expect(down).toMatchObject({ kind: "office.down.engine", held: [] });
      expect(pushedToPhone([waiting?.id, down?.id])).toEqual([down?.id]);

      // Past midnight and up to the window's end.
      await schedule.advanceTo(new Date(2100, 0, testDay + 1, 6, 59));
      expect(raised).toHaveLength(2);
      await schedule.advanceTo(new Date(2100, 0, testDay + 1, 7, 0));

      const summary = raised[2]?.notification;
      expect(summary).toMatchObject({
        kind: "quiet-hours-summary",
        line: "During quiet hours: 1 needs you.",
        pointsTo: { kind: "since-you-left" },
        channels: ["desktop", "phone"],
        gathers: [waiting?.id],
      });
      expect(pushedToPhone([waiting?.id, summary?.id])).toEqual([summary?.id]);

      await events.publish(decisionEvent(DecisionAnswered, decision));
      expect(cleared).toEqual([waiting?.id, summary?.id]);
    });

    it("send the summary at once when they are turned off with something held", async () => {
      await schedule.advanceTo(new Date(2100, 0, testDay, 23, 0));
      await events.publish(
        decisionEvent(DecisionOpened, { id: randomUUID(), taskId: randomUUID() }),
      );

      const response = await fetch(`${url}/api/notifications/timing`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...DEFAULT_TIMING, quietHours: null }),
      });

      expect(response.status).toBe(200);
      expect(raisedNotifications().map(({ kind }) => kind)).toEqual([
        "needs-you.decision",
        "quiet-hours-summary",
      ]);
    });
  });

  describe("batching", () => {
    it("collapses Outcomes landing close together into one, cleared once each is handled", async () => {
      const tasks = [randomUUID(), randomUUID(), randomUUID()] as const;
      await events.publish(new TaskStateChanged(tasks[0], "in-progress", "done"));
      await schedule.advanceTo(noon(1));
      await events.publish(new TaskStateChanged(tasks[1], "in-progress", "done"));
      await schedule.advanceTo(noon(2));
      await events.publish(new TaskStateChanged(tasks[2], "in-progress", "done"));
      // Needs you is never batched.
      await events.publish(decisionEvent(DecisionOpened, { id: randomUUID(), taskId: tasks[0] }));

      const [first, collapsed, again, waiting] = raised;
      expect(first?.notification).toMatchObject({ kind: "outcomes.task-done", line: "Done." });
      expect(collapsed?.notification).toMatchObject({
        kind: "collapsed-outcomes",
        line: "2 Tasks done",
        pointsTo: { kind: "since-you-left" },
        channels: ["in-app", "desktop"],
      });
      expect(collapsed?.replaces).toEqual([first?.notification.id]);
      expect(again?.notification.line).toBe("3 Tasks done");
      expect(again?.replaces).toEqual([collapsed?.notification.id]);
      expect(waiting?.notification.kind).toBe("needs-you.decision");
      const ids = (await listed()).map(({ id }) => id);
      expect(ids).toContain(again?.notification.id);
      expect(ids).not.toContain(first?.notification.id);
      expect(ids).not.toContain(collapsed?.notification.id);

      await openTask(tasks[1]);
      await openTask(tasks[2]);
      expect(cleared).not.toContain(again?.notification.id);
      await openTask(tasks[0]);

      expect(cleared).toContain(again?.notification.id);
    });

    it("lets an Outcome after the window come on its own", async () => {
      await events.publish(new TaskStateChanged(randomUUID(), "in-progress", "done"));
      await schedule.advanceTo(noon(2));
      await events.publish(new TaskStateChanged(randomUUID(), "in-progress", "done"));

      expect(raisedNotifications().map(({ kind }) => kind)).toEqual([
        "outcomes.task-done",
        "outcomes.task-done",
      ]);
    });
  });
});
