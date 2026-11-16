import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import {
  notificationListSchema,
  notificationRoutingSchema,
  notificationTimingSchema,
  type Notification,
  type NotificationRouting,
  type NotificationTiming,
} from "@the-office/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../test/test-application.js";
import { EventBus } from "../../../platform/events/event-bus.js";
import { Schedule } from "../../../platform/schedule/schedule.js";
import type { ManualSchedule } from "../../../platform/schedule/schedule.fixtures.js";
import { EventsModule } from "../../../platform/events/events.module.js";
import { EventStreamModule } from "../../../platform/websocket/event-stream.module.js";
import {
  DecisionAnswered,
  DecisionClosed,
  DecisionOpened,
  DecisionReopened,
  TurnEnded,
} from "../../conversations/index.js";
import {
  EngineDown,
  UsageWindowReset,
  UsageWindowsChanged,
  UsageWindowUsedUp,
} from "../../engine/index.js";
import { OfficeUpdated, OfficeUpdateFailed } from "../../office-updates/index.js";
import { CARETAKER } from "../../people/index.js";
import { GateContinued, GateReached, NoRetriesLeft } from "../../pipelines/index.js";
import {
  InitiativeStateChanged,
  TaskPaused,
  TaskResumed,
  TaskStateChanged,
} from "../../work/index.js";
import { toRoutingResponse } from "../adapters/http/notification-responses.js";
import {
  NotificationRaised,
  NotificationsCleared,
  RoutingChanged,
} from "../domain/notification-events.js";
import { DEFAULT_ROUTING } from "../domain/notification-kinds.js";
import { NotificationsModule } from "../notifications.module.js";
import {
  AccountUsageForTests,
  DeskLimitForTests,
  StartQueueForTests,
  KnownPeopleForTests,
  NotificationsPortsForTestsModule,
  OfficeFireAlarmForTests,
  OfficeStatusCardsForTests,
  ResumePlansForTests,
  OfficeInitiativesForTests,
  OfficeTasksForTests,
  OpenDecisionsForTests,
  TaskStageProgressForTests,
} from "../ports/notifications-ports.fixtures.js";

type DecisionEventParameters = ConstructorParameters<typeof DecisionOpened>;

/** Only what Notifications reads of a Decision: who asks what, on which Task, in what home. */
function decisionEvent(
  eventClass:
    | typeof DecisionOpened
    | typeof DecisionReopened
    | typeof DecisionAnswered
    | typeof DecisionClosed,
  decision: { readonly id: string; readonly taskId?: string; readonly roleKey: string | undefined },
  home: { readonly kind: "task" | "chat" } = { kind: "task" },
): DecisionOpened {
  const [thread, asked] = [
    { home },
    { ...decision, questions: [{ kind: "open", question: "Keep the query string?" }] },
  ] as unknown as [DecisionEventParameters[0], DecisionEventParameters[1]];
  return new eventClass(thread, asked, new Date());
}

/** An engine's account's windows as the engine reads them, the 5-hour one this much used. */
function reading(
  percentUsed: number,
  engine = { id: "claude-code", name: "Claude Code" },
): UsageWindowsChanged {
  return new UsageWindowsChanged(engine.id, engine.name, {
    fiveHour: { percentUsed, resetsAt: new Date("2026-10-27T12:00:00Z") },
    sevenDay: { percentUsed: 10, resetsAt: undefined },
    source: "rate-limit-headers",
  });
}

function down(engineId: string, engineName: string): EngineDown {
  return new EngineDown("s1", engineId, engineName, "Signed out.");
}

function claudeCodeDown(): EngineDown {
  return new EngineDown("s1", "claude-code", "Claude Code", "Claude Code didn't start.");
}

/** A turn of a session on the engine came back, so that engine answers again. */
function turnEndedOn(engineId: string): TurnEnded {
  return new TurnEnded({ session: { engineId } } as TurnEnded["thread"], new Date());
}

async function routingOf(response: Response): Promise<NotificationRouting> {
  expect(response.status).toBe(200);
  return notificationRoutingSchema.parse(await response.json());
}

/**
 * Outcomes landing close together collapse, also those of other files running at once: each test
 * raises on a day of its own in 2001, which no other file's clock reaches.
 */
let testDay = 0;

describe("NotificationService", () => {
  let app: INestApplication;
  let url: string;
  let events: EventBus;
  let schedule: ManualSchedule;
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
    }));
    events = app.get(EventBus);
    schedule = app.get(Schedule, { strict: false }) as ManualSchedule;
    testDay += 1;
    schedule.setTime(new Date(2001, 0, testDay, 12));
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

  async function readRouting(): Promise<NotificationRouting> {
    return routingOf(await fetch(`${url}/api/notifications/routing`));
  }

  async function changeRouting(
    method: "PUT" | "DELETE",
    level: string,
    body?: unknown,
  ): Promise<Response> {
    return fetch(`${url}/api/notifications/routing/${level}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
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
      channels: ["in-app", "desktop", "phone"],
    });
    expect((await openNotifications()).map(({ id }) => id)).toContain(notification?.id);

    await events.publish(decisionEvent(DecisionAnswered, decision));

    expect(cleared).toEqual([notification?.id]);
    expect((await openNotifications()).map(({ id }) => id)).not.toContain(notification?.id);
  });

  it("raises nothing for a chat's Decision, which waits on the user inline in the chat", async () => {
    const decision = { id: randomUUID(), roleKey: "developer" };

    await events.publish(decisionEvent(DecisionOpened, decision, { kind: "chat" }));
    await events.publish(decisionEvent(DecisionReopened, decision, { kind: "chat" }));

    expect(raised).toEqual([]);
  });

  it("clears a Decision's Notification as its Task's Drop closes it", async () => {
    const decision = { id: randomUUID(), taskId: randomUUID(), roleKey: "developer" };
    await events.publish(decisionEvent(DecisionOpened, decision));
    const [notification] = raised.map((event) => event.notification);
    expect(notification?.pointsTo).toMatchObject({ kind: "decision", decisionId: decision.id });

    await events.publish(decisionEvent(DecisionClosed, decision));

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

  it("tells a Stage failing with no retries left, unless it was put to a Consultant first", async () => {
    const [toAConsultant, toTheUser] = [randomUUID(), randomUUID()];
    for (const taskId of [toAConsultant, toTheUser]) {
      app.get(OfficeTasksForTests).people.set(taskId, "developer");
      app.get(TaskStageProgressForTests).stages.set(taskId, [
        {
          stage: { key: "measure", name: "Measure", kind: "script" },
          state: "waiting-on-you",
          runs: [],
        },
      ]);
    }

    await events.publish(new NoRetriesLeft(toAConsultant, "measure", "2 tests fail.", "architect"));
    await events.publish(new NoRetriesLeft(toTheUser, "measure", "2 tests fail.", undefined));

    expect(raised.map(({ notification }) => notification.pointsTo)).toEqual([
      { kind: "task", taskId: toTheUser },
    ]);
  });

  it("tells a Task paused by the user, but none the fire alarm or its Initiative's Pause paused", async () => {
    const [byTheUser, byTheAlarm, byTheInitiative] = [randomUUID(), randomUUID(), randomUUID()];

    await events.publish(new TaskPaused(byTheAlarm, "in-progress", "alarm"));
    await events.publish(new TaskPaused(byTheInitiative, "in-progress", "initiative"));
    await events.publish(new TaskPaused(byTheUser, "in-progress"));

    expect(raised.map(({ notification }) => notification.pointsTo)).toEqual([
      { kind: "task", taskId: byTheUser },
    ]);
  });

  it("tells a Task its engine's used-up usage window paused, with when it resumes, cleared by the resume", async () => {
    const [refused, handedBack] = [randomUUID(), randomUUID()];
    const resetsAt = new Date(2001, 0, testDay, 14);
    const refusal = {
      engineId: "claude-code",
      engineName: "Claude Code",
      window: "five-hour",
      resetsAt,
    };

    await events.publish(new TaskPaused(refused, "in-progress", "usage-window", refusal));
    // A refusal moving the resume on, and the Initiative's Resume handing a Task back: no Outcome.
    await events.publish(new TaskPaused(refused, "paused", "usage-window", refusal));
    await events.publish(new TaskPaused(handedBack, "paused", "usage-window"));

    expect(raised.map(({ notification }) => notification)).toEqual([
      expect.objectContaining({
        kind: "outcomes.task-paused",
        line: "Paused: Claude Code's 5-hour window is used up. Resumes at 14:00.",
        pointsTo: { kind: "task", taskId: refused },
      }),
    ]);

    await events.publish(new TaskResumed(refused));

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

  it("tells an Initiative done, from whoever holds Shapes Initiatives, and clears it when the user opens it", async () => {
    const [first, second] = [randomUUID(), randomUUID()];

    await events.publish(new InitiativeStateChanged(first, "shaping", "active"));
    await events.publish(new InitiativeStateChanged(first, "active", "done"));
    app.get(KnownPeopleForTests).holders.set("shapes-initiatives", "architect");
    // Past the batching window, so the second isn't collapsed with the first.
    await schedule.advanceBy(3 * 60_000);
    await events.publish(new InitiativeStateChanged(second, "active", "done"));

    expect(raised.map(({ notification }) => notification)).toEqual([
      expect.objectContaining({
        kind: "outcomes.initiative-done",
        roleKey: undefined,
        line: "The Initiative is done.",
        pointsTo: { kind: "initiative", initiativeId: first },
        channels: ["in-app", "desktop"],
      }),
      expect.objectContaining({
        roleKey: "architect",
        line: "Our Initiative is done: every one of its Tasks is Done.",
        pointsTo: { kind: "initiative", initiativeId: second },
      }),
    ]);

    await reportActivity({ kind: "initiative", initiativeId: first });

    expect(cleared).toEqual([raised[0]?.notification.id]);
  });

  it("tells the 5-hour window nearly used at 90%, and its reset, which clears that", async () => {
    await events.publish(reading(89));
    await events.publish(reading(91));
    await events.publish(reading(4));

    expect(raised.map(({ notification }) => [notification.kind, notification.channels])).toEqual([
      ["office.window.nearly-used", ["in-app"]],
      ["office.window.reset", ["in-app"]],
    ]);
    expect(cleared).toContain(raised[0]?.notification.id);
  });

  it("tells an engine's usage window used up in the office.window row, handled at its reset", async () => {
    const resetsAt = new Date(2001, 0, testDay, 14);
    const otherEngine = { id: "used-up-lab-account", name: "Lab account" };

    await events.publish(
      new UsageWindowUsedUp("claude-code", "Claude Code", "five-hour", resetsAt),
    );
    await events.publish(
      new UsageWindowUsedUp(otherEngine.id, otherEngine.name, "seven-day-opus", resetsAt),
    );

    expect(raised.map(({ notification }) => notification)).toEqual([
      expect.objectContaining({
        kind: "office.window.used-up",
        roleKey: CARETAKER,
        line: "Claude Code's 5-hour window is used up until 14:00. I've paused the Tasks on it, and the rest wait.",
        pointsTo: { kind: "office", engineId: "claude-code" },
        channels: ["in-app"],
      }),
      expect.objectContaining({
        line: "Lab account's Opus weekly window is used up until 14:00. I've paused the Tasks on it, and the rest wait.",
      }),
    ]);

    // A 5-hour reading going down doesn't tell a used-up window reset; its own reset does.
    await events.publish(reading(91));
    await events.publish(reading(4));
    expect(cleared).not.toContain(raised[0]?.notification.id);
    await events.publish(new UsageWindowReset("claude-code", "five-hour"));

    expect(cleared).toContain(raised[0]?.notification.id);
    expect(cleared).not.toContain(raised[1]?.notification.id);
  });

  it("keeps each engine's 5-hour window apart, telling and clearing only that engine's", async () => {
    const workAccount = { id: "window-work-account", name: "Work account" };
    const labAccount = { id: "window-lab-account", name: "Lab account" };
    await events.publish(reading(90, workAccount));
    await events.publish(reading(10, labAccount));
    await events.publish(reading(92, workAccount));
    await events.publish(reading(95, labAccount));
    await events.publish(reading(4, workAccount));

    expect(raised.map(({ notification }) => notification.line)).toEqual([
      "We've used 90% of Work account's 5-hour window.",
      "We've used 95% of Lab account's 5-hour window.",
      "Work account's 5-hour window reset, so we have all of it again.",
    ]);
    expect(cleared).toEqual([raised[0]?.notification.id]);
    // Opening Now handles both engines' windows.
    await reportActivity({ kind: "now" });
  });

  it("has the Office kinds come from the Caretaker while nobody holds Default person to talk to, then from its holder", async () => {
    const people = app.get(KnownPeopleForTests);
    people.holders.set("shapes-initiatives", "architect");
    await events.publish(reading(91));
    await events.publish(claudeCodeDown());
    // The engine answers again and the user opens Now, which handles both.
    await events.publish(turnEndedOn("claude-code"));
    await reportActivity({ kind: "now" });

    people.holders.set("default-person-to-talk-to", "receptionist");
    await events.publish(reading(4));
    await events.publish(reading(93));
    await events.publish(claudeCodeDown());

    expect(raised.map(({ notification }) => [notification.roleKey, notification.line])).toEqual([
      [CARETAKER, "We've used 91% of Claude Code's 5-hour window."],
      [CARETAKER, "I can't reach Claude Code: Claude Code didn't start."],
      ["receptionist", "Claude Code's 5-hour window reset, so we have all of it again."],
      ["receptionist", "We've used 93% of Claude Code's 5-hour window."],
      ["receptionist", "I can't reach Claude Code: Claude Code didn't start."],
    ]);
    const open = await openNotifications();
    expect(open.find(({ id }) => id === raised[4]?.notification.id)?.roleKey).toBe("receptionist");
    // One engine down is open at a time on the shared database: the engine answers again.
    await events.publish(turnEndedOn("claude-code"));
  });

  it("tells an Office update's result, the newer replacing the older, handled on Settings › Updates", async () => {
    const from = "1234567aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const to = "89abcdefbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    await events.publish(new OfficeUpdated(from, to, new Date()));
    await events.publish(new OfficeUpdateFailed(to, from, "the build", new Date()));

    expect(raised.map(({ notification }) => [notification.kind, notification.line])).toEqual([
      ["office.update.done", "I updated The Office to 89abcde."],
      [
        "office.update.failed",
        "The Office's update failed at the build, so I took it back to 89abcde. The log is in Settings › Updates.",
      ],
    ]);
    const open = (await openNotifications()).filter(({ kind }) => kind.startsWith("office.update"));
    expect(open.map(({ kind, pointsTo }) => [kind, pointsTo])).toEqual([
      ["office.update.failed", { kind: "office-update" }],
    ]);
    await reportActivity({ kind: "office-update" });
    expect(
      (await openNotifications()).filter(({ kind }) => kind.startsWith("office.update")),
    ).toEqual([]);
  });

  it("names a release's update by its versions, whole, with the step it failed at", async () => {
    await events.publish(new OfficeUpdated("1.3.0", "1.4.0", new Date()));
    await events.publish(
      new OfficeUpdateFailed("1.4.0", "1.5.0", "starting the new version", new Date()),
    );

    expect(raised.map(({ notification }) => notification.line)).toEqual([
      "I updated The Office to 1.4.0.",
      "The Office's update failed at starting the new version, so I took it back to 1.4.0. The log is in Settings › Updates.",
    ]);
    await reportActivity({ kind: "office-update" });
  });

  it("raises each engine's down on its own, handled when that engine answers again", async () => {
    // Engine ids no other file raises, as the database is shared.
    await events.publish(down("work-account", "Work account"));
    await events.publish(down("home-account", "Home account"));
    await events.publish(down("work-account", "Work account"));

    expect(raised.map(({ notification }) => notification.line)).toEqual([
      "I can't reach Work account: Signed out.",
      "I can't reach Home account: Signed out.",
    ]);
    const [work, home] = raised.map(({ notification }) => notification.id);
    await events.publish(turnEndedOn("work-account"));
    expect(cleared).toContain(work);
    expect(cleared).not.toContain(home);
    await events.publish(turnEndedOn("home-account"));
    expect(cleared).toContain(home);
  });

  describe("the routing", () => {
    // The routing is one table for every test file, which run at once: these tests change only
    // levels no other file raises, and give each back.
    afterEach(async () => {
      for (const level of ["office.window", "office.alarm-lifted"]) {
        await changeRouting("DELETE", level);
      }
    });

    it("starts from ticket 20's defaults, as the migration stored them", async () => {
      expect(await readRouting()).toEqual(toRoutingResponse(DEFAULT_ROUTING));
    });

    it("sets a channel at a kind, shows where each channel comes from, and resets it", async () => {
      const changed: RoutingChanged[] = [];
      events.subscribe(RoutingChanged, (event) => void changed.push(event));

      const set = await routingOf(
        await changeRouting("PUT", "office.alarm-lifted", { channel: "phone", on: true }),
      );

      expect(set["office.alarm-lifted"]).toEqual({
        "in-app": { on: true, from: "office" },
        desktop: { on: false, from: "office" },
        phone: { on: true, from: "office.alarm-lifted" },
      });
      expect(changed.map(({ routing }) => routing["office.alarm-lifted"])).toEqual([
        { phone: true },
      ]);

      const reset = await routingOf(await changeRouting("DELETE", "office.alarm-lifted"));

      expect(reset["office.alarm-lifted"]?.phone).toEqual({ on: false, from: "office" });
      expect(await readRouting()).toEqual(reset);
    });

    it("refuses a level that isn't in the kinds tree, a group's reset and a channel it doesn't know", async () => {
      expect(
        (await changeRouting("PUT", "office.coffee", { channel: "phone", on: true })).status,
      ).toBe(404);
      expect((await changeRouting("DELETE", "office")).status).toBe(400);
      expect(
        (await changeRouting("PUT", "office.alarm-lifted", { channel: "email", on: true })).status,
      ).toBe(400);
    });

    it("routes every new Notification by what is stored", async () => {
      await routingOf(await changeRouting("PUT", "office.window", { channel: "phone", on: true }));

      // Opening Now handles any window Notification an earlier test left open.
      await reportActivity({ kind: "now" });
      await events.publish(reading(91));

      expect(raised.map(({ notification }) => notification.channels)).toEqual([
        ["in-app", "phone"],
      ]);
    });
  });

  describe("the timing", () => {
    // The timing is one row for every test file, which run at once: this test sets quiet hours
    // the system's clock is outside of for a while, and gives the defaults back.
    afterEach(async () => {
      await changeTiming(url, TIMING_DEFAULTS);
    });

    it("starts from ticket 20's defaults, as the migration stored them", async () => {
      expect(await readTiming(url)).toEqual(TIMING_DEFAULTS);
    });

    it("keeps the minutes and quiet hours the user sets", async () => {
      const timing = {
        holdPhoneMinutes: 10,
        awayMinutes: 15,
        batchOutcomesMinutes: 3,
        quietHours: { from: hoursFromNow(3), to: hoursFromNow(4) },
      };

      const response = await changeTiming(url, timing);

      expect(response.status).toBe(200);
      expect(await readTiming(url)).toEqual(timing);
    });

    it("refuses minutes under one, a time that isn't one and quiet hours ending as they start", async () => {
      for (const timing of [
        { ...TIMING_DEFAULTS, awayMinutes: 0 },
        { ...TIMING_DEFAULTS, quietHours: { from: "25:00", to: "07:00" } },
        { ...TIMING_DEFAULTS, quietHours: { from: "22:00", to: "22:00" } },
      ]) {
        expect((await changeTiming(url, timing)).status).toBe(400);
      }
    });
  });
});

const MINUTE_MS = 60_000;

const TIMING_DEFAULTS = {
  holdPhoneMinutes: 5,
  awayMinutes: 5,
  batchOutcomesMinutes: 2,
  quietHours: null,
};

async function changeTiming(url: string, timing: unknown): Promise<Response> {
  return fetch(`${url}/api/notifications/timing`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(timing),
  });
}

async function readTiming(url: string): Promise<NotificationTiming> {
  const response = await fetch(`${url}/api/notifications/timing`);
  expect(response.status).toBe(200);
  return notificationTimingSchema.parse(await response.json());
}

/** "HH:MM" this many hours from the system's time. */
function hoursFromNow(hours: number): string {
  const at = new Date(Date.now() + hours * 60 * MINUTE_MS);
  return `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
}
