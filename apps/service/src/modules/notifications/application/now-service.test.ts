import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { nowSchema, type Now } from "@the-office/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../test/test-application.js";
import { EventBus } from "../../../platform/events/event-bus.js";
import { EventsModule } from "../../../platform/events/events.module.js";
import { EventStreamModule } from "../../../platform/websocket/event-stream.module.js";
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

  it("carries the fire alarm while it is on, with how each Task it paused would resume", async () => {
    const taskId = randomUUID();
    tasks.tasks = [
      { id: taskId, title: "Add a filter", projectId: "p1", state: "paused", pausedBy: "alarm" },
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
});
