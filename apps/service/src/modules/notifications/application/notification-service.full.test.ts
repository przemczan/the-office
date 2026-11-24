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
import type { SignedIn } from "../../../platform/http/signed-in-requests.js";
import { signedInAs } from "../../../platform/http/signed-in-requests.fixtures.js";
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
import { ActionRunStateChanged } from "../../actions/index.js";
import { TestInstanceStateChanged } from "../../test-instances/index.js";
import {
  GateContinued,
  GateReached,
  NoRetriesLeft,
  StandInChoicesChanged,
} from "../../pipelines/index.js";
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
  StandInChoicesWaitingForTests,
  OpenProposalsForTests,
  PullRequestsWaitingForTests,
  SkillUpdatesFoundForTests,
  OfficeUpdateAvailableForTests,
  ShapingRepliesForTests,
  OfficeUsersForTests,
  OfficeOffBoardTasksForTests,
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

/** A Decision event in a Thread of the given home, on no Task. */
function onNoTask(
  eventClass:
    | typeof DecisionOpened
    | typeof DecisionReopened
    | typeof DecisionAnswered
    | typeof DecisionClosed,
  home:
    | { readonly kind: "initiative"; readonly initiativeId: string }
    | { readonly kind: "chat"; readonly roleKey: string },
  decision: { readonly id: string; readonly threadId: string },
): DecisionOpened {
  const [thread, asked] = [
    { id: decision.threadId, home },
    {
      ...decision,
      taskId: undefined,
      roleKey: "architect",
      questions: [{ kind: "open", question: "Split billing out?" }],
    },
  ] as unknown as [DecisionEventParameters[0], DecisionEventParameters[1]];
  return new eventClass(thread, asked, new Date());
}

/**
 * An engine's account's windows as the engine reads them, the 5-hour one this much used: in the
 * window that resets at 14:00 of the test's day, or `window` windows after it.
 */
function reading(
  percentUsed: number,
  engine = { id: "claude-code", name: "Claude Code" },
  window = 0,
): UsageWindowsChanged {
  return new UsageWindowsChanged(engine.id, engine.name, {
    fiveHour: { percentUsed, resetsAt: windowResetsAt(window) },
    sevenDay: { percentUsed: 10, resetsAt: undefined },
    source: "rate-limit-headers",
  });
}

/** When the test's 5-hour window resets, or the one `window` windows after it. */
function windowResetsAt(window = 0): Date {
  return new Date(2001, 0, testDay, 14 + 5 * window);
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

/** A Stage of a Task in `projectId` waiting for the choice of a Stand-in Engine since `minute` past 12:00. */
function waitingStage(
  projectId: string,
  minute: number,
): StandInChoicesWaitingForTests["choices"][number] {
  return {
    taskId: randomUUID(),
    projectId,
    waitingSince: new Date(2001, 0, testDay, 12, minute),
    resetsAt: new Date(2001, 0, testDay, 14).toISOString(),
    standInNow: { engineName: "Spare" },
    asked: { engineName: "Spare" },
  };
}

/** A test instance of the-office on feature/search moving `from` → `to`. */
function moved(
  instance: { readonly instanceId: string; readonly initiativeId?: string },
  from: TestInstanceStateChanged["from"],
  to: TestInstanceStateChanged["to"],
  details: {
    readonly targetName?: string;
    readonly failedReason?: string;
    readonly stoppedBy?: TestInstanceStateChanged["stoppedBy"];
    readonly files?: readonly string[];
  } = {},
): TestInstanceStateChanged {
  return new TestInstanceStateChanged(
    instance.instanceId,
    "the-office",
    instance.initiativeId,
    from,
    to,
    undefined,
    details.targetName ?? "Web app",
    "feature/search",
    details.failedReason,
    details.stoppedBy,
    details.files ?? [],
  );
}

/** An Action run of the-office's Action `release`, on main, moving as `to` says. */
function actionRunMoved(
  runId: string,
  to: ActionRunStateChanged["to"],
  details: {
    readonly kind?: ActionRunStateChanged["kind"];
    readonly endedBecause?: string;
    readonly outcome?: ActionRunStateChanged["outcome"];
  } = {},
): ActionRunStateChanged {
  const outcome =
    details.outcome ?? (to === "succeeded" || to === "failed" || to === "stopped" ? to : undefined);
  return new ActionRunStateChanged(
    runId,
    "the-office",
    "release",
    "Release",
    details.kind ?? "project-command",
    "main",
    "running",
    to,
    outcome,
    details.endedBecause,
    to === "stopped" ? "by-user" : undefined,
  );
}

/** A user of the test's own, as a request signs them in. */
function aUser(id: string = randomUUID()): SignedIn {
  return { userId: id, name: "Ada", signedInDeviceId: randomUUID() };
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
  let users: OfficeUsersForTests;
  /** The test's one user, whom every Notification reaches and every request signs in. */
  let user: SignedIn;
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
          standInChoicesWaiting: StandInChoicesWaitingForTests,
          openProposals: OpenProposalsForTests,
          pullRequestsWaiting: PullRequestsWaitingForTests,
          skillUpdatesFound: SkillUpdatesFoundForTests,
          officeUpdateAvailable: OfficeUpdateAvailableForTests,
          shapingReplies: ShapingRepliesForTests,
          officeUsers: OfficeUsersForTests,
          officeOffBoardTasks: OfficeOffBoardTasksForTests,
        }),
      ],
    }));
    events = app.get(EventBus);
    users = app.get(OfficeUsersForTests);
    user = aUser(users.firstUserId);
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

  async function openNotifications(as: SignedIn = user): Promise<Notification[]> {
    const response = await fetch(`${url}/api/notifications`, { headers: signedInAs(as) });
    expect(response.status).toBe(200);
    return notificationListSchema.parse(await response.json());
  }

  async function ownOpenRuns(actionKey: string): Promise<Notification[]> {
    return (await openNotifications()).filter(
      ({ pointsTo }) => pointsTo.kind === "action-run" && pointsTo.actionKey === actionKey,
    );
  }

  async function ownOpen(instanceId: string): Promise<Notification[]> {
    return (await openNotifications()).filter(
      ({ pointsTo }) => pointsTo.kind === "test-instance" && pointsTo.instanceId === instanceId,
    );
  }

  async function reportActivity(page: unknown): Promise<void> {
    const response = await fetch(`${url}/api/activity`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...signedInAs(user) },
      body: JSON.stringify({ page }),
    });
    expect(response.status).toBe(204);
  }

  async function readRouting(as: SignedIn = user): Promise<NotificationRouting> {
    return routingOf(
      await fetch(`${url}/api/account/notifications/routing`, { headers: signedInAs(as) }),
    );
  }

  async function changeRouting(
    method: "PUT" | "DELETE",
    level: string,
    body?: unknown,
    as: SignedIn = user,
  ): Promise<Response> {
    return fetch(`${url}/api/account/notifications/routing/${level}`, {
      method,
      headers: { "Content-Type": "application/json", ...signedInAs(as) },
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

  function anInitiative(): { readonly kind: "initiative"; readonly initiativeId: string } {
    const initiativeId = randomUUID();
    app.get(OfficeInitiativesForTests).initiatives = [
      { id: initiativeId, name: "Billing", state: "shaping", createdAt: new Date() },
    ];
    return { kind: "initiative", initiativeId };
  }

  describe("a Decision on no Task", () => {
    it("in an Initiative's Thread names the Initiative and opens its page at that Thread", async () => {
      const home = anInitiative();
      const decision = { id: randomUUID(), threadId: randomUUID() };

      await events.publish(onNoTask(DecisionOpened, home, decision));

      expect(raised.map(({ notification }) => notification)).toEqual([
        expect.objectContaining({
          kind: "needs-you.decision",
          roleKey: "architect",
          line: "On the Initiative Billing, I need your answer: Split billing out?",
          pointsTo: {
            kind: "initiative",
            initiativeId: home.initiativeId,
            decisionId: decision.id,
            threadId: decision.threadId,
          },
        }),
      ]);
      expect((await openNotifications()).map(({ pointsTo }) => pointsTo)).toContainEqual(
        raised[0]?.notification.pointsTo,
      );
    });

    it("stays open as the user opens the Initiative, and clears once answered", async () => {
      const home = anInitiative();
      const decision = { id: randomUUID(), threadId: randomUUID() };
      await events.publish(onNoTask(DecisionOpened, home, decision));

      await reportActivity({ kind: "initiative", initiativeId: home.initiativeId });
      expect(cleared).toEqual([]);

      await events.publish(onNoTask(DecisionAnswered, home, decision));
      expect(cleared).toEqual([raised[0]?.notification.id]);
    });

    it("clears once closed as its Initiative ended", async () => {
      const home = anInitiative();
      const decision = { id: randomUUID(), threadId: randomUUID() };
      await events.publish(onNoTask(DecisionOpened, home, decision));

      await events.publish(onNoTask(DecisionClosed, home, decision));

      expect(cleared).toEqual([raised[0]?.notification.id]);
    });

    it("asked again, clears the one answered and raises the one asked anew", async () => {
      const home = anInitiative();
      const first = { id: randomUUID(), threadId: randomUUID() };
      const again = { id: randomUUID(), threadId: first.threadId };
      await events.publish(onNoTask(DecisionOpened, home, first));
      await events.publish(onNoTask(DecisionAnswered, home, first));

      await events.publish(onNoTask(DecisionOpened, home, again));
      await events.publish(onNoTask(DecisionReopened, home, again));

      expect(raised.map(({ notification }) => notification.pointsTo)).toEqual([
        expect.objectContaining({ decisionId: first.id }),
        expect.objectContaining({ decisionId: again.id }),
      ]);
      expect(cleared).toEqual([raised[0]?.notification.id]);
    });

    it("raises nothing in a chat, and its answer clears nothing", async () => {
      const decision = { id: randomUUID(), threadId: randomUUID() };
      const home = { kind: "chat" as const, roleKey: "office-manager" };

      await events.publish(onNoTask(DecisionOpened, home, decision));
      await events.publish(onNoTask(DecisionAnswered, home, decision));

      expect(raised).toEqual([]);
      expect(cleared).toEqual([]);
    });
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
        line: "Paused: Claude Code's 5-hour window is used up. Resumes at {time}.",
        at: resetsAt,
        pointsTo: { kind: "task", taskId: refused },
      }),
    ]);

    await events.publish(new TaskResumed(refused));

    expect(cleared).toEqual([raised[0]?.notification.id]);
  });

  it("tells no Task paused for a Stage that waits for the choice of a Stand-in Engine", async () => {
    const [waits, plain] = [randomUUID(), randomUUID()];
    const refusal = {
      engineId: "claude-code",
      engineName: "Claude Code",
      window: "five-hour",
      resetsAt: new Date(2001, 0, testDay, 14),
    };

    await events.publish(
      new TaskPaused(waits, "in-progress", "usage-window", {
        ...refusal,
        awaitsStandInChoice: true,
      }),
    );
    await events.publish(new TaskPaused(plain, "in-progress", "usage-window", refusal));

    expect(raised.map(({ notification }) => notification.pointsTo)).toEqual([
      { kind: "task", taskId: plain },
    ]);
  });

  describe("the Stages waiting for the choice of a Stand-in Engine", () => {
    let choices: StandInChoicesWaitingForTests;

    /** The rows change, then Pipelines tells it, as it does once the held run is saved. */
    async function changeTo(waiting: StandInChoicesWaitingForTests["choices"]): Promise<void> {
      choices.choices = waiting;
      await events.publish(new StandInChoicesChanged(waiting[0]?.taskId ?? randomUUID()));
    }

    beforeEach(async () => {
      choices = app.get(StandInChoicesWaitingForTests);
      app.get(KnownPeopleForTests).holders.set("default-person-to-talk-to", "office-manager");
      // The card is one for The Office, so one an earlier test left open is cleared first.
      await changeTo([]);
      [raised, cleared] = [[], []];
    });

    afterEach(async () => {
      await changeTo([]);
    });

    it("raises one Notification for two Stages, from the Default person to talk to", async () => {
      const first = waitingStage("p1", 5);
      await changeTo([first, waitingStage("p2", 9)]);

      expect(raised.map(({ notification }) => notification)).toEqual([
        expect.objectContaining({
          kind: "needs-you.decision",
          roleKey: "office-manager",
          line: "2 paused Stages wait for your choice: switch to Spare, or wait for the reset at {time}.",
          at: new Date(first.resetsAt),
          pointsTo: { kind: "stand-in-choice" },
        }),
      ]);
    });

    it("words one Stage, and names the Stand-in Engine it was held asking while none has room", async () => {
      await changeTo([
        { ...waitingStage("p1", 5), standInNow: null, asked: { engineName: "Backup" } },
      ]);

      expect(raised.map(({ notification }) => notification.line)).toEqual([
        "1 paused Stage waits for your choice: switch to Backup, or wait for the reset at {time}.",
      ]);
    });

    it("raises none again while it is open, as a Stage joins", async () => {
      const first = waitingStage("p1", 5);
      await changeTo([first]);
      await changeTo([first, waitingStage("p2", 9)]);

      expect(raised).toHaveLength(1);
    });

    it("clears it once no Stage waits for the choice", async () => {
      await changeTo([waitingStage("p1", 5)]);
      const id = raised[0]?.notification.id;

      await changeTo([]);

      expect(cleared).toEqual([id]);
      expect((await openNotifications()).map(({ pointsTo }) => pointsTo.kind)).not.toContain(
        "stand-in-choice",
      );
    });
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
    await events.publish(reading(4, undefined, 1));

    expect(raised.map(({ notification }) => [notification.kind, notification.channels])).toEqual([
      ["office.window.nearly-used", ["in-app"]],
      ["office.window.reset", ["in-app"]],
    ]);
    expect(cleared).toContain(raised[0]?.notification.id);
  });

  it("tells no reset of a 5-hour window that reads lower before its reset time, nor clears its nearly used", async () => {
    const engine = { id: "window-dip-account", name: "Dip account" };
    await events.publish(reading(91, engine));
    // A dip within the window that resets at 14:00, read at noon: neither a reset nor a crossing.
    await events.publish(reading(60, engine));
    await events.publish(reading(92, engine));

    expect(raised.map(({ notification }) => notification.kind)).toEqual([
      "office.window.nearly-used",
    ]);
    expect(cleared).toEqual([]);

    // Once the clock reaches the reset time, a lower reading is the window's reset.
    await schedule.advanceTo(windowResetsAt());
    await events.publish(reading(3, engine));

    expect(raised.map(({ notification }) => notification.kind)).toEqual([
      "office.window.nearly-used",
      "office.window.reset",
    ]);
    expect(cleared).toEqual([raised[0]?.notification.id]);
    await reportActivity({ kind: "now" });
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
        line: "Claude Code's 5-hour window is used up until {time}. I've paused the Tasks on it, and the rest wait.",
        shortLine: "Claude Code used up until {time}",
        at: resetsAt,
        pointsTo: { kind: "office", engineId: "claude-code" },
        channels: ["in-app"],
      }),
      expect.objectContaining({
        line: "Lab account's Opus weekly window is used up until {time}. I've paused the Tasks on it, and the rest wait.",
      }),
    ]);
    // Kept with the instant, which the web words in the browser's time zone.
    const listed = await openNotifications();
    expect(listed.find(({ id }) => id === raised[0]?.notification.id)?.at).toBe(
      resetsAt.toISOString(),
    );

    // A 5-hour reading going down doesn't tell a used-up window reset; its own reset does.
    await events.publish(reading(91));
    await events.publish(reading(4, undefined, 1));
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
    await events.publish(reading(4, workAccount, 1));

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
    await events.publish(reading(4, undefined, 1));
    await events.publish(reading(93, undefined, 1));
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

  describe("an Action run's end", () => {
    it("tells Succeeded in the UI's voice, unbatched, until the user opens the Action's History", async () => {
      const runId = randomUUID();

      await events.publish(actionRunMoved(runId, "succeeded"));

      const [notification] = raised.map((event) => event.notification);
      expect(notification).toMatchObject({
        kind: "outcomes.action-run.succeeded",
        roleKey: undefined,
        line: "Release on main succeeded.",
        pointsTo: { kind: "action-run", runId, projectId: "the-office", actionKey: "release" },
        channels: ["in-app", "desktop"],
      });
      await reportActivity({ kind: "test-instances", projectId: "the-office" });
      expect(await ownOpenRuns("release")).toHaveLength(1);
      await reportActivity({
        kind: "action-history",
        projectId: "the-office",
        actionKey: "release",
      });
      expect(await ownOpenRuns("release")).toEqual([]);
    });

    it("tells Failed saying why, leaving only the Action's latest open", async () => {
      await events.publish(actionRunMoved(randomUUID(), "succeeded"));
      await events.publish(
        actionRunMoved(randomUUID(), "failed", {
          endedBecause: "The command ended with exit code 1.",
        }),
      );

      expect(raised.map(({ notification }) => notification.line)).toEqual([
        "Release on main succeeded.",
        "Release on main failed: The command ended with exit code 1.",
      ]);
      expect((await ownOpenRuns("release")).map(({ kind }) => kind)).toEqual([
        "outcomes.action-run.failed",
      ]);
    });

    it("tells nothing of a Stopped run, a Test target run or a run going on", async () => {
      await events.publish(actionRunMoved(randomUUID(), "stopped"));
      await events.publish(actionRunMoved(randomUUID(), "failed", { kind: "test-target" }));
      await events.publish(actionRunMoved(randomUUID(), "running"));

      expect(raised).toEqual([]);
    });
  });

  describe("a test instance's state", () => {
    it("tells Running in the UI's voice, naming the Initiative, until the user opens its page", async () => {
      const { initiativeId } = anInitiative();
      const instance = { instanceId: randomUUID(), initiativeId };

      await events.publish(moved(instance, "building", "running"));

      const [notification] = raised.map((event) => event.notification);
      expect(notification).toMatchObject({
        kind: "outcomes.test-instance.running",
        roleKey: undefined,
        line: "Web app in Billing is Running.",
        pointsTo: { kind: "test-instance", projectId: "the-office", ...instance },
        channels: ["in-app", "desktop"],
      });
      await reportActivity({ kind: "test-instances", projectId: "the-office" });
      expect(await ownOpen(instance.instanceId)).toHaveLength(1);
      await reportActivity({ kind: "initiative", initiativeId });
      expect(await ownOpen(instance.instanceId)).toEqual([]);
    });

    it("tells Built with its files, cleared by the Project's Test targets when it is linked to none", async () => {
      const instance = { instanceId: randomUUID() };

      await events.publish(
        moved(instance, "building", "built", { targetName: "Android app", files: ["app.apk"] }),
      );

      expect(raised.map(({ notification }) => [notification.kind, notification.line])).toEqual([
        ["outcomes.test-instance.built", "Android app on feature/search is Built: app.apk."],
      ]);
      await reportActivity({ kind: "test-instances", projectId: "the-office" });
      expect(await ownOpen(instance.instanceId)).toEqual([]);
    });

    it("replaces Running with the failure once it fails, saying why", async () => {
      const instance = { instanceId: randomUUID() };

      await events.publish(moved(instance, "building", "running"));
      await events.publish(
        moved(instance, "running", "failed", { failedReason: "Exited with code 1." }),
      );

      const [running, failed] = raised.map(({ notification }) => notification);
      expect(cleared).toContain(running?.id);
      expect(failed?.line).toBe("Web app on feature/search failed: Exited with code 1.");
      expect((await ownOpen(instance.instanceId)).map(({ kind }) => kind)).toEqual([
        "outcomes.test-instance.failed",
      ]);

      await events.publish(moved(instance, "failed", "building"));
      expect(await ownOpen(instance.instanceId)).toEqual([]);
    });

    it("clears Running once it is Stopped, telling nothing more", async () => {
      const instance = { instanceId: randomUUID() };

      await events.publish(moved(instance, "building", "running"));
      await events.publish(moved(instance, "running", "stopped", { stoppedBy: "by-user" }));

      expect(raised).toHaveLength(1);
      expect(await ownOpen(instance.instanceId)).toEqual([]);
    });

    it("raises none for a build the user's Stop or its Initiative's end failed, but one for any other failure", async () => {
      for (const stoppedBy of ["by-user", "initiative-ended"] as const) {
        await events.publish(
          moved({ instanceId: randomUUID() }, "building", "failed", {
            failedReason: "Stopped by you.",
            stoppedBy,
          }),
        );
      }
      expect(raised).toEqual([]);

      const instance = { instanceId: randomUUID() };
      await events.publish(
        moved(instance, "building", "failed", {
          failedReason: "Stopped after 30 minutes with no request.",
          stoppedBy: "idle",
        }),
      );
      expect(raised.map(({ notification }) => notification.kind)).toEqual([
        "outcomes.test-instance.failed",
      ]);
      await events.publish(moved(instance, "failed", "building"));
    });

    it("never collapses with a Task's Outcome landing close by", async () => {
      const taskId = randomUUID();
      const instance = { instanceId: randomUUID() };

      await events.publish(new TaskStateChanged(taskId, "in-progress", "done"));
      await events.publish(moved(instance, "building", "running"));

      expect(raised.map(({ notification }) => notification.kind)).toEqual([
        "outcomes.task-done",
        "outcomes.test-instance.running",
      ]);
      expect(raised.map(({ replaces }) => replaces)).toEqual([[], []]);
      await reportActivity({ kind: "task", taskId });
      await events.publish(moved(instance, "running", "stopped"));
    });
  });

  describe("the routing", () => {
    // Each test's user is its own, so their routing is apart from every other file's.

    it("starts a user with no routing of their own from ticket 20's defaults", async () => {
      expect(await readRouting()).toEqual(toRoutingResponse(DEFAULT_ROUTING));
      expect(await readRouting(aUser())).toEqual(toRoutingResponse(DEFAULT_ROUTING));
    });

    it("keeps each user's routing their own", async () => {
      const other = aUser();

      await routingOf(
        await changeRouting("PUT", "office.alarm-lifted", { channel: "phone", on: true }),
      );

      expect((await readRouting())["office.alarm-lifted"]?.phone.on).toBe(true);
      expect(await readRouting(other)).toEqual(toRoutingResponse(DEFAULT_ROUTING));
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
      expect(changed.map(({ userId }) => userId)).toEqual([user.userId]);

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

    it("delivers to each user on their own channels, and to none whose routing gives it none", async () => {
      const [other, unrouted] = [aUser(), aUser()];
      users.users = [{ id: user.userId }, { id: other.userId }, { id: unrouted.userId }];
      await routingOf(await changeRouting("PUT", "office.window", { channel: "phone", on: true }));
      await routingOf(
        await changeRouting("PUT", "office.window", { channel: "in-app", on: false }, unrouted),
      );

      await reportActivity({ kind: "now" });
      await events.publish(reading(91));

      expect(raised.map(({ userId, notification }) => [userId, notification.channels])).toEqual([
        [user.userId, ["in-app", "phone"]],
        [other.userId, ["in-app"]],
      ]);
      const id = raised[0]?.notification.id;
      expect(raised[1]?.notification.id).toBe(id);
      // The shared Notification is in each one's list, on no channel for whom it reached nowhere.
      const [mine, theirs, none] = await Promise.all(
        [user, other, unrouted].map(async (as) =>
          (await openNotifications(as)).find((notification) => notification.id === id),
        ),
      );
      expect(mine?.channels).toEqual(["in-app", "phone"]);
      expect(theirs?.channels).toEqual(["in-app"]);
      expect(none?.channels).toEqual([]);
      await reportActivity({ kind: "now" });
    });

    it("never collapses a new Outcome with one that reached the user on no channel", async () => {
      for (const channel of ["in-app", "desktop"]) {
        await routingOf(await changeRouting("PUT", "outcomes.task-done", { channel, on: false }));
      }
      const [done, paused] = [randomUUID(), randomUUID()];

      await events.publish(new TaskStateChanged(done, "in-progress", "done"));
      await schedule.advanceBy(60_000);
      await events.publish(new TaskPaused(paused, "in-progress"));

      expect(raised.map(({ notification }) => notification.kind)).toEqual(["outcomes.task-paused"]);
      expect(raised[0]?.replaces).toEqual([]);
      await reportActivity({ kind: "task", taskId: done });
      await reportActivity({ kind: "task", taskId: paused });
    });
  });

  describe("the timing", () => {
    // Each test's user is its own, so their timing is apart from every other file's.

    it("starts a user with no timing of their own from ticket 20's defaults", async () => {
      expect(await readTiming(url, user)).toEqual(TIMING_DEFAULTS);
      expect(await readTiming(url, aUser())).toEqual(TIMING_DEFAULTS);
    });

    it("keeps the minutes and quiet hours the user sets", async () => {
      const timing = {
        holdPhoneMinutes: 10,
        awayMinutes: 15,
        batchOutcomesMinutes: 3,
        quietHours: { from: hoursFromNow(3), to: hoursFromNow(4) },
      };

      const response = await changeTiming(url, timing, user);

      expect(response.status).toBe(200);
      expect(await readTiming(url, user)).toEqual(timing);
      expect(await readTiming(url, aUser())).toEqual(TIMING_DEFAULTS);
    });

    it("refuses minutes under one, a time that isn't one and quiet hours ending as they start", async () => {
      for (const timing of [
        { ...TIMING_DEFAULTS, awayMinutes: 0 },
        { ...TIMING_DEFAULTS, quietHours: { from: "25:00", to: "07:00" } },
        { ...TIMING_DEFAULTS, quietHours: { from: "22:00", to: "22:00" } },
      ]) {
        expect((await changeTiming(url, timing, user)).status).toBe(400);
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

async function changeTiming(url: string, timing: unknown, as: SignedIn): Promise<Response> {
  return fetch(`${url}/api/account/notifications/timing`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...signedInAs(as) },
    body: JSON.stringify(timing),
  });
}

async function readTiming(url: string, as: SignedIn): Promise<NotificationTiming> {
  const response = await fetch(`${url}/api/account/notifications/timing`, {
    headers: signedInAs(as),
  });
  expect(response.status).toBe(200);
  return notificationTimingSchema.parse(await response.json());
}

/** "HH:MM" this many hours from the system's time. */
function hoursFromNow(hours: number): string {
  const at = new Date(Date.now() + hours * 60 * MINUTE_MS);
  return `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
}
