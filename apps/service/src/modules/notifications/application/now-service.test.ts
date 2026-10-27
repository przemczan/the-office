import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { notificationsWebEventSchema, nowSchema, type Now } from "@the-office/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startTestApplication } from "../../../../test/test-application.js";
import { EventBus } from "../../../platform/events/event-bus.js";
import { EventsModule } from "../../../platform/events/events.module.js";
import { EventStreamModule } from "../../../platform/websocket/event-stream.module.js";
import { WebEventForwarding } from "../../../platform/websocket/web-event-forwarding.js";
import { TokensCounted, TurnEnded } from "../../conversations/index.js";
import { StageRunStarted } from "../../pipelines/index.js";
import { TaskStateChanged } from "../../work/index.js";
import { NowChanged } from "../domain/now-events.js";
import { NotificationsModule } from "../notifications.module.js";
import {
  AccountUsageForTests,
  DeskLimitForTests,
  KnownPeopleForTests,
  NotificationsPortsForTestsModule,
  OfficeStatusCardsForTests,
  OfficeTasksForTests,
  OpenDecisionsForTests,
  TaskStageProgressForTests,
} from "../ports/notifications-ports.fixtures.js";

type CountedThread = ConstructorParameters<typeof TokensCounted>[0];

/** Only what Now reads of a Thread: its id and its tokens. */
function threadWith(id: string, ended: number, running: number): CountedThread {
  const thread = {
    id,
    tokens: { input: ended, output: 0, cacheRead: 0, cacheCreation: 0 },
    runningTurnTokens: { input: 0, output: 0, cacheRead: running, cacheCreation: 0 },
  };
  return thread as unknown as CountedThread;
}

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
          knownPeople: KnownPeopleForTests,
          accountUsage: AccountUsageForTests,
          officeStatusCards: OfficeStatusCardsForTests,
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

  function lastAnnounced(): NowChanged | undefined {
    return announced.at(-1);
  }

  it("reads what waits, what runs and the desks from the modules that own them", async () => {
    const taskId = randomUUID();
    const decisionId = randomUUID();
    tasks.tasks = [{ id: taskId, title: "Add a filter", projectId: "p1", state: "in-progress" }];
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
    app.get(AccountUsageForTests).current = {
      fiveHour: { percentUsed: 42, resetsAt: new Date("2026-10-27T12:00:00Z") },
    };

    const now = await readNow();

    expect(now.needsYou).toEqual([
      { kind: "decision", decisionId, taskId, waitingSince: "2026-10-27T09:05:00.000Z" },
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
    expect(now.fiveHourWindow).toEqual({ percentUsed: 42, resetsAt: "2026-10-27T12:00:00.000Z" });
  });

  it("keeps a Task done after the user was seen, and announces it in Since you left", async () => {
    const activity = await fetch(`${url}/api/activity`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ page: { kind: "elsewhere" } }),
    });
    expect(activity.status).toBe(204);
    const taskId = randomUUID();
    tasks.tasks = [{ id: taskId, title: "Add a filter", projectId: "p1", state: "done" }];

    await events.publish(new TaskStateChanged(taskId, "in-progress", "done"));

    await vi.waitFor(() => {
      expect(lastAnnounced()?.now.sinceYouLeft).toContainEqual(
        expect.objectContaining({ taskId, outcome: "done" }),
      );
    });
    expect((await readNow()).sinceYouLeft).toContainEqual(
      expect.objectContaining({ taskId, outcome: "done" }),
    );
  });

  it("counts today's tokens by how much each Thread grew, and each Task touched once", async () => {
    const before = await readNow();
    const threadId = randomUUID();
    const taskId = randomUUID();

    await events.publish(new TokensCounted(threadWith(threadId, 0, 150), new Date()));
    // The turn's own count replaces the running one: 140 in all, not 290.
    await events.publish(new TurnEnded(threadWith(threadId, 140, 0), new Date()));
    await events.publish(new StageRunStarted(taskId, randomUUID(), "build"));
    await events.publish(new StageRunStarted(taskId, randomUUID(), "test"));

    const now = await readNow();
    expect(now.tokensToday - before.tokensToday).toBe(140);
    expect(now.tasksTouched - before.tasksTouched).toBe(1);
  });

  it("counts a Thread first seen with earlier turns from those turns, not from nothing", async () => {
    const before = await readNow();

    await events.publish(new TokensCounted(threadWith(randomUUID(), 5_000, 30), new Date()));

    expect((await readNow()).tokensToday - before.tokensToday).toBe(30);
  });

  it("sends Now to the web whole", async () => {
    await events.publish(new StageRunStarted(randomUUID(), randomUUID(), "build"));

    await vi.waitFor(() => expect(lastAnnounced()).toBeDefined());
    const webEvent = app.get(WebEventForwarding).toWebEvent(lastAnnounced()!);
    expect(notificationsWebEventSchema.parse(webEvent)).toMatchObject({ type: "now.changed" });
  });
});
