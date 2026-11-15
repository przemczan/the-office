import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { nowSchema, type Now } from "@the-office/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startTestApplication } from "../../../../test/test-application.js";
import { EventBus } from "../../../platform/events/event-bus.js";
import { EventsModule } from "../../../platform/events/events.module.js";
import { EventStreamModule } from "../../../platform/websocket/event-stream.module.js";
import { DecisionClosed, DecisionOpened } from "../../conversations/index.js";
import { InitiativeStateChanged } from "../../work/index.js";
import { NowChanged } from "../domain/now-events.js";
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

describe("NowService", () => {
  let app: INestApplication;
  let url: string;
  let events: EventBus;
  let tasks: OfficeTasksForTests;
  let announced: NowChanged[];

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
    tasks = app.get(OfficeTasksForTests);
    announced = [];
    events.subscribe(NowChanged, (event) => void announced.push(event));
  });

  afterEach(async () => {
    await app.close();
  });

  async function readNow(): Promise<Now> {
    const response = await fetch(`${url}/api/now`);
    expect(response.status).toBe(200);
    return nowSchema.parse(await response.json());
  }

  it("reads what waits, what runs and the desks from the modules that own them", async () => {
    const taskId = randomUUID();
    const decisionId = randomUUID();
    tasks.tasks = [
      {
        id: taskId,
        title: "Add a filter",
        projectId: "p1",
        state: "in-progress",
        pausedBy: undefined,
        resumesAt: undefined,
      },
    ];
    app.get(TaskStageProgressForTests).stages.set(taskId, [
      {
        stage: { key: "build", name: "Build", kind: "agent", role: "developer" },
        state: "running",
        runs: [{ startedAt: new Date("2026-10-27T09:00:00Z"), endedAt: undefined }],
      },
    ]);
    app.get(OpenDecisionsForTests).open = [
      { id: decisionId, taskId, askedAt: new Date("2026-10-27T09:05:00Z") },
    ];
    app.get(DeskLimitForTests).limit = 4;
    const usage = app.get(AccountUsageForTests).readingsByEngine;
    usage.set("claude-code", {
      fiveHour: { percentUsed: 42, resetsAt: new Date("2026-10-27T12:00:00Z") },
      sevenDay: { percentUsed: 17, resetsAt: new Date("2026-10-30T09:00:00Z") },
    });
    usage.set("work-account", {
      fiveHour: { percentUsed: 0, resetsAt: undefined },
      sevenDay: { percentUsed: 5, resetsAt: new Date("2026-11-01T09:00:00Z") },
    });

    const now = await readNow();

    expect(now.needsYou).toEqual([
      {
        kind: "decision",
        decisionId,
        taskId,
        projectId: "p1",
        waitingSince: "2026-10-27T09:05:00.000Z",
      },
    ]);
    expect(now.running).toEqual([
      {
        taskId,
        title: "Add a filter",
        projectId: "p1",
        state: "in-progress",
        pausedBy: null,
        resumesAt: null,
        stage: {
          key: "build",
          name: "Build",
          role: "developer",
          since: "2026-10-27T09:00:00.000Z",
        },
      },
    ]);
    expect(now.desks).toEqual({ inUse: 1, limit: 4 });
    expect(now.usageWindows).toEqual([
      {
        engineId: "claude-code",
        fiveHour: { percentUsed: 42, resetsAt: "2026-10-27T12:00:00.000Z" },
        sevenDay: { percentUsed: 17, resetsAt: "2026-10-30T09:00:00.000Z" },
      },
      {
        engineId: "work-account",
        fiveHour: { percentUsed: 0, resetsAt: null },
        sevenDay: { percentUsed: 5, resetsAt: "2026-11-01T09:00:00.000Z" },
      },
    ]);
  });

  it("no longer lists a Decision its Task's Drop closed, and announces it", async () => {
    const taskId = randomUUID();
    const decision = { id: randomUUID(), taskId, askedAt: new Date("2026-10-27T09:05:00Z") };
    tasks.tasks = [
      {
        id: taskId,
        title: "Add a filter",
        projectId: "p1",
        state: "waiting-on-you",
        pausedBy: undefined,
        resumesAt: undefined,
      },
    ];
    const decisions = app.get(OpenDecisionsForTests);
    decisions.open = [decision];
    await events.publish(decisionEvent(DecisionOpened, decision));
    await vi.waitFor(() =>
      expect(announced.at(-1)?.now.needsYou).toEqual([
        expect.objectContaining({ kind: "decision", decisionId: decision.id }),
      ]),
    );

    decisions.open = [];
    await events.publish(decisionEvent(DecisionClosed, decision));

    await vi.waitFor(() => expect(announced.at(-1)?.now.needsYou).toEqual([]));
    expect((await readNow()).needsYou).toEqual([]);
  });

  it("carries the fire alarm while it is on, with how each Task it paused would resume", async () => {
    const taskId = randomUUID();
    tasks.tasks = [
      {
        id: taskId,
        title: "Add a filter",
        projectId: "p1",
        state: "paused",
        pausedBy: "alarm",
        resumesAt: undefined,
      },
    ];
    const alarm = app.get(OfficeFireAlarmForTests);
    const off = await readNow();
    alarm.alarm = { on: true, since: new Date("2026-10-29T09:00:00Z") };
    const stopping = await readNow();
    app.get(ResumePlansForTests).resumes.set(taskId, {
      kind: "re-caches",
      stageName: "Build",
      contextTokens: 12_000,
      briefTokens: 0,
      tokens: 12_000,
    });

    const planned = await readNow();

    expect(off.fireAlarm).toBeNull();
    expect(stopping.fireAlarm).toMatchObject({
      stopping: true,
      paused: [{ taskId, resume: null }],
    });
    expect(planned.fireAlarm).toEqual({
      since: "2026-10-29T09:00:00.000Z",
      stopping: false,
      paused: [
        {
          taskId,
          title: "Add a filter",
          projectId: "p1",
          stage: null,
          resume: {
            kind: "re-caches",
            stageName: "Build",
            contextTokens: 12_000,
            briefTokens: 0,
            tokens: 12_000,
          },
        },
      ],
      resumeTokens: 12_000,
    });
  });

  it("lists the Initiatives in Shaping, oldest first, shaped by nobody while nobody holds the duty", async () => {
    const [older, newer] = [randomUUID(), randomUUID()];
    const initiatives = app.get(OfficeInitiativesForTests);
    initiatives.initiatives = [
      { id: newer, name: "Billing", state: "shaping", createdAt: new Date("2026-11-15T10:00:00Z") },
      { id: randomUUID(), name: "Search", state: "active", createdAt: new Date("2026-11-01") },
      {
        id: older,
        name: "Onboarding",
        state: "shaping",
        createdAt: new Date("2026-11-15T08:00:00Z"),
      },
    ];
    initiatives.tasks.set(older, [
      { projectId: "p1", state: "shaping" },
      { projectId: "p2", state: "shaping" },
    ]);

    const nobody = await readNow();
    app.get(KnownPeopleForTests).holders.set("shapes-initiatives", "product-owner");
    const held = await readNow();

    expect(nobody.shaping).toEqual([
      {
        initiativeId: older,
        title: "Onboarding",
        projectIds: ["p1", "p2"],
        shapedBy: null,
        taskCount: 2,
        since: "2026-11-15T08:00:00.000Z",
      },
      {
        initiativeId: newer,
        title: "Billing",
        projectIds: [],
        shapedBy: null,
        taskCount: 0,
        since: "2026-11-15T10:00:00.000Z",
      },
    ]);
    expect(held.shaping.map(({ shapedBy }) => shapedBy)).toEqual([
      "product-owner",
      "product-owner",
    ]);
  });

  it("announces Now once an Initiative leaves Shaping", async () => {
    const initiativeId = randomUUID();
    const initiatives = app.get(OfficeInitiativesForTests);
    const shaping = {
      id: initiativeId,
      name: "Onboarding",
      state: "shaping",
      createdAt: new Date(),
    };
    initiatives.initiatives = [shaping];
    await events.publish(new InitiativeStateChanged(randomUUID(), "shaping", "active"));
    await vi.waitFor(() =>
      expect(announced.at(-1)?.now.shaping).toEqual([expect.objectContaining({ initiativeId })]),
    );

    initiatives.initiatives = [{ ...shaping, state: "active" }];
    await events.publish(new InitiativeStateChanged(initiativeId, "shaping", "active"));

    await vi.waitFor(() => expect(announced.at(-1)?.now.shaping).toEqual([]));
  });
});

type DecisionEventParameters = ConstructorParameters<typeof DecisionOpened>;

/** Only what Now reads of a Decision: which one, on which Task. */
function decisionEvent(
  eventClass: typeof DecisionOpened | typeof DecisionClosed,
  decision: { readonly id: string; readonly taskId: string },
): DecisionOpened | DecisionClosed {
  const [thread, asked] = [{}, decision] as unknown as [
    DecisionEventParameters[0],
    DecisionEventParameters[1],
  ];
  return new eventClass(thread, asked, new Date());
}
