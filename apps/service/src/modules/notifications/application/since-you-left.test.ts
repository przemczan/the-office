import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { sinceYouLeftSchema, type SinceYouLeft } from "@the-office/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startTestApplication } from "../../../../test/test-application.js";
import { EventBus } from "../../../platform/events/event-bus.js";
import { EventsModule } from "../../../platform/events/events.module.js";
import type { SignedIn } from "../../../platform/http/signed-in-requests.js";
import { signedInAs } from "../../../platform/http/signed-in-requests.fixtures.js";
import { Schedule } from "../../../platform/schedule/schedule.js";
import { ManualSchedule } from "../../../platform/schedule/schedule.fixtures.js";
import { EventStreamModule } from "../../../platform/websocket/event-stream.module.js";
import { DecisionOpened } from "../../conversations/index.js";
import { TaskStateChanged } from "../../work/index.js";
import { RecordingPhonePush } from "../adapters/phone/recording-phone-push.js";
import { NotificationRaised } from "../domain/notification-events.js";
import { NowChanged } from "../domain/now-events.js";
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
  OfficeInitiativesForTests,
  OfficeTasksForTests,
  OpenDecisionsForTests,
  ResumePlansForTests,
  StartQueueForTests,
  TaskStageProgressForTests,
} from "../ports/notifications-ports.fixtures.js";
import { PhonePush } from "../ports/phone-push.js";
import { UserActivityRepository } from "../ports/user-activity-repository.js";

const NOTIFICATIONS_FOR_TESTS = NotificationsModule.register({
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
});

/** A user of this test alone: the stored activity is one row a user for every test file. */
function aUser(name: string): SignedIn {
  return { userId: randomUUID(), name, signedInDeviceId: randomUUID() };
}

describe("Since you left, for each user", () => {
  let app: INestApplication;
  let url: string;
  let events: EventBus;
  let tasks: OfficeTasksForTests;
  const start = new Date();
  const minutes = (count: number): Date => new Date(start.getTime() + count * 60_000);

  beforeEach(async () => {
    // The activity runs on The Office's clock and the outcomes on the system's, both faked here.
    vi.useFakeTimers({ toFake: ["Date"] });
    ({ app, url } = await startTestApplication({
      database: true,
      imports: [EventsModule, EventStreamModule, NOTIFICATIONS_FOR_TESTS],
      // The Notifications its outcomes raise stay apart from the other files'.
      overrides: [{ provide: NotificationRepository, useValue: new NotificationsForTests() }],
    }));
    events = app.get(EventBus);
    tasks = app.get(OfficeTasksForTests);
  });

  afterEach(async () => {
    await app.close();
    vi.useRealTimers();
  });

  async function activeAt(user: SignedIn, at: Date): Promise<void> {
    vi.setSystemTime(at);
    const response = await fetch(`${url}/api/activity`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...signedInAs(user) },
      body: JSON.stringify({ page: { kind: "elsewhere" } }),
    });
    expect(response.status).toBe(204);
  }

  async function doneAt(title: string, at: Date): Promise<string> {
    vi.setSystemTime(at);
    const taskId = randomUUID();
    tasks.tasks = [
      ...tasks.tasks,
      {
        id: taskId,
        title,
        projectId: "p1",
        state: "done",
        pausedBy: undefined,
        resumesAt: undefined,
      },
    ];
    await events.publish(new TaskStateChanged(taskId, "in-progress", "done"));
    return taskId;
  }

  async function sinceYouLeftOf(user: SignedIn): Promise<SinceYouLeft> {
    const response = await fetch(`${url}/api/now/since-you-left`, { headers: signedInAs(user) });
    expect(response.status).toBe(200);
    return sinceYouLeftSchema.parse(await response.json());
  }

  it("begins at each user's own absence, with the outcomes since then", async () => {
    const [ann, ben] = [aUser("Ann Lee"), aUser("Ben Ito")];
    await activeAt(ann, minutes(0));
    await activeAt(ben, minutes(0));
    const first = await doneAt("Add a filter", minutes(1));
    await activeAt(ann, minutes(2));
    const second = await doneAt("Fix the header", minutes(10));
    // Both come back after an absence: Ann's began after her last activity, Ben's earlier.
    await activeAt(ann, minutes(20));
    await activeAt(ben, minutes(20));

    const [annSince, benSince] = [await sinceYouLeftOf(ann), await sinceYouLeftOf(ben)];

    expect(annSince.leftAt).toBe(minutes(2).toISOString());
    expect(annSince.finished.map(({ taskId }) => taskId)).toEqual([second]);
    expect(benSince.leftAt).toBe(minutes(0).toISOString());
    expect(benSince.finished.map(({ taskId }) => taskId)).toEqual([second, first]);
  });

  it("has no start for a user not yet seen, and tells every web of an outcome by now.changed", async () => {
    const announced: NowChanged[] = [];
    events.subscribe(NowChanged, (event) => void announced.push(event));
    await activeAt(aUser("Ann Lee"), minutes(0));
    await vi.waitFor(() => expect(announced.length).toBeGreaterThan(0));
    const seen = announced.length;

    await doneAt("Add a filter", minutes(1));

    await vi.waitFor(() => expect(announced.length).toBeGreaterThan(seen));
    expect(await sinceYouLeftOf(aUser("Cy Moss"))).toEqual({ leftAt: null, finished: [] });
  });
});

/** Noon of a day of the phone test's own, plus some minutes. */
function noon(minutes = 0): Date {
  return new Date(2103, 0, 1, 12, minutes);
}

describe("The phone, with two users", () => {
  let app: INestApplication;
  let url: string;
  let events: EventBus;
  let schedule: ManualSchedule;

  beforeEach(async () => {
    schedule = new ManualSchedule();
    schedule.setTime(noon());
    ({ app, url } = await startTestApplication({
      database: true,
      imports: [EventsModule, EventStreamModule, NOTIFICATIONS_FOR_TESTS],
      // Notifications, timing and activity of this test alone, on a clock of its own.
      overrides: [
        { provide: Schedule, useValue: schedule },
        { provide: NotificationRepository, useValue: new NotificationsForTests() },
        { provide: NotificationTimingRepository, useValue: new NotificationTimingForTests() },
        { provide: UserActivityRepository, useValue: new UserActivityForTests() },
      ],
    }));
    events = app.get(EventBus);
  });

  afterEach(async () => {
    await app.close();
  });

  async function active(user: SignedIn): Promise<void> {
    const response = await fetch(`${url}/api/activity`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...signedInAs(user) },
      body: JSON.stringify({ page: { kind: "elsewhere" } }),
    });
    expect(response.status).toBe(204);
  }

  it("goes only once every user is away", async () => {
    const raised: string[] = [];
    events.subscribe(NotificationRaised, ({ notification }) => void raised.push(notification.id));
    await active(aUser("Ann Lee"));
    await schedule.advanceTo(noon(3));
    await active(aUser("Ben Ito"));
    const [thread, asked] = [
      {},
      {
        id: randomUUID(),
        taskId: randomUUID(),
        roleKey: "developer",
        questions: [{ kind: "open", question: "Keep it?" }],
        askedAt: noon(3),
      },
    ] as unknown as ConstructorParameters<typeof DecisionOpened>;
    await events.publish(new DecisionOpened(thread, asked));
    expect(raised).toHaveLength(1);
    const pushed = (): string[] =>
      (app.get(PhonePush) as RecordingPhonePush).pushed
        .map(({ id }) => id)
        .filter((id) => raised.includes(id));

    // Ann has been away the hold and the away delay by 12:10, but Ben is still at the desk.
    await schedule.advanceTo(noon(12));
    expect(pushed()).toEqual([]);

    await schedule.advanceTo(noon(13));
    expect(pushed()).toEqual(raised);
  });
});
