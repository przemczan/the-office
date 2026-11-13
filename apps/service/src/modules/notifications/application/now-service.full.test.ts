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

type CountedThread = ConstructorParameters<typeof TokensCounted>[0];

/** Only what Now reads of a Thread: its id and its tokens. */
function grownBy(before: Now, after: Now): Now["tokensToday"] {
  return {
    input: after.tokensToday.input - before.tokensToday.input,
    output: after.tokensToday.output - before.tokensToday.output,
    cacheRead: after.tokensToday.cacheRead - before.tokensToday.cacheRead,
    cacheCreation: after.tokensToday.cacheCreation - before.tokensToday.cacheCreation,
  };
}

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

  function lastAnnounced(): NowChanged | undefined {
    return announced.at(-1);
  }

  it("keeps a Task done after the user was seen, and announces it in Since you left", async () => {
    const activity = await fetch(`${url}/api/activity`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ page: { kind: "elsewhere" } }),
    });
    expect(activity.status).toBe(204);
    const taskId = randomUUID();
    tasks.tasks = [
      {
        id: taskId,
        title: "Add a filter",
        projectId: "p1",
        state: "done",
        pausedBy: undefined,
        resumesAt: undefined,
      },
    ];

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

  describe("on a day of its own", () => {
    // The day's figures are kept by day in tables every test file shares, and other files' Stage
    // runs and turns count on the system's day: a year no other file's clock reaches keeps them out.
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(2002, 0, 1, 12));
    });

    afterEach(() => {
      vi.useRealTimers();
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
      // Each kind apart: the running turn's cache reads went as the ended turn's input came.
      expect(grownBy(before, now)).toEqual({
        input: 140,
        output: 0,
        cacheRead: 0,
        cacheCreation: 0,
      });
      expect(now.tasksTouched - before.tasksTouched).toBe(1);
    });

    it("counts a Thread first seen with earlier turns from those turns, not from nothing", async () => {
      const before = await readNow();

      await events.publish(new TokensCounted(threadWith(randomUUID(), 5_000, 30), new Date()));

      expect(grownBy(before, await readNow())).toEqual({
        input: 0,
        output: 0,
        cacheRead: 30,
        cacheCreation: 0,
      });
    });
  });

  it("sends Now to the web whole", async () => {
    await events.publish(new StageRunStarted(randomUUID(), randomUUID(), "build"));

    await vi.waitFor(() => expect(lastAnnounced()).toBeDefined());
    const webEvent = app.get(WebEventForwarding).toWebEvent(lastAnnounced()!);
    expect(notificationsWebEventSchema.parse(webEvent)).toMatchObject({ type: "now.changed" });
  });
});
