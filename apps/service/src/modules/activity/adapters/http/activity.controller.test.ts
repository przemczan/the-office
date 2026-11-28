import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { activitySchema, activityWebEventSchema, type Activity } from "@the-office/contracts";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import { EventsModule } from "../../../../platform/events/events.module.js";
import {
  ANOTHER_SIGNED_IN_FOR_TESTS,
  SIGNED_IN_FOR_TESTS,
  signedInAs,
} from "../../../../platform/http/signed-in-requests.fixtures.js";
import { Schedule } from "../../../../platform/schedule/schedule.js";
import type { ManualSchedule } from "../../../../platform/schedule/schedule.fixtures.js";
import { EventStreamModule } from "../../../../platform/websocket/event-stream.module.js";
import { WebEventForwarding } from "../../../../platform/websocket/web-event-forwarding.js";
import { ActivityModule } from "../../activity.module.js";
import { ActivityChanged } from "../../domain/activity-events.js";
import {
  ACTIVITY_PORTS_FOR_TESTS,
  ActivityCiRunsForTests,
  ActivityDevicesForTests,
  ActivityOffBoardTasksForTests,
  ActivitySessionsForTests,
  ActivityTasksForTests,
  activityTask,
} from "../../ports/activity-ports.fixtures.js";

const NOW = new Date("2026-11-21T12:00:00Z");

let app: INestApplication;
let url: string;
let projectId: string;
let taskId: string;

beforeAll(async () => {
  ({ app, url } = await startTestApplication({
    database: true,
    imports: [EventsModule, EventStreamModule, ActivityModule.register(ACTIVITY_PORTS_FOR_TESTS)],
  }));
  (app.get(Schedule) as ManualSchedule).setTime(NOW);
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  app.get(ActivitySessionsForTests).sessions = [];
  app.get(ActivitySessionsForTests).sessionsOfUser.clear();
  projectId = randomUUID();
  taskId = randomUUID();
  app.get(ActivityTasksForTests).tasks = [activityTask({ id: taskId, projectId })];
  app.get(ActivityOffBoardTasksForTests).offBoardTasks = [];
  app.get(ActivityCiRunsForTests).runs = [
    {
      id: 41,
      attempt: 1,
      projectId,
      taskId,
      workflow: "CI",
      title: "Add a filter",
      status: "failed",
      startedAt: new Date("2026-11-21T10:00:00Z"),
      updatedAt: new Date("2026-11-21T11:00:00Z"),
      url: "https://github.com/acme/office/actions/runs/41",
    },
  ];
  app.get(ActivityDevicesForTests).devices = [
    {
      id: randomUUID(),
      taskId,
      projectId,
      kind: "serial-usb",
      name: "ESP32",
      state: "connected",
      connectedAt: new Date("2026-11-21T08:00:00Z"),
    },
  ];
});

async function readActivity(headers: Record<string, string> = {}): Promise<Activity> {
  const response = await fetch(`${url}/api/activity`, { headers });
  expect(response.status).toBe(200);
  return activitySchema.parse(await response.json());
}

describe("GET /activity", () => {
  it("answers the activities and the other running work, newest first, and the count of both", async () => {
    app.get(ActivitySessionsForTests).sessions = [
      {
        threadId: randomUUID(),
        roleKey: "developer",
        subject: { kind: "task", taskId },
        sessionKind: "stage",
        state: "waiting",
        waitingOn: { kind: "decision", question: "Which way?" },
        since: new Date("2026-11-21T09:30:00Z"),
      },
    ];

    const activity = await readActivity();

    expect(activity.activities).toEqual([
      expect.objectContaining({
        id: `task:${taskId}`,
        subject: expect.objectContaining({ kind: "task", taskId, projectId, initiativeId: null }),
        link: { kind: "task", taskId },
        since: "2026-11-21T09:30:00.000Z",
        sessions: [
          expect.objectContaining({
            person: { kind: "person", roleKey: "developer" },
            sessionKind: "stage",
            state: "waiting",
            waitingOn: { kind: "decision", question: "Which way?" },
          }),
        ],
      }),
    ]);
    expect(activity.otherWork.map(({ kind }) => kind)).toEqual(["connected-device"]);
    expect(activity.count).toBe(2);
  });

  it("lists a finished CI run in neither list, and a Task with no session either", async () => {
    const activity = await readActivity();

    expect(activity.activities).toEqual([]);
    expect(activity.otherWork.map(({ kind }) => kind)).toEqual(["connected-device"]);
    expect(activity.count).toBe(1);
  });

  it("answers each user's own sessions, never another user's chat", async () => {
    const threadId = randomUUID();
    app.get(ActivitySessionsForTests).sessionsOfUser.set(SIGNED_IN_FOR_TESTS.userId, [
      {
        threadId,
        roleKey: "cto",
        subject: { kind: "chat", threadId, roleKey: "cto", title: "Plan the quarter" },
        sessionKind: "chat",
        state: "waiting",
        waitingOn: { kind: "reply", question: undefined },
        since: new Date("2026-11-21T11:00:00Z"),
      },
    ]);

    const ofAnn = await readActivity(signedInAs(SIGNED_IN_FOR_TESTS));
    const ofBen = await readActivity(signedInAs(ANOTHER_SIGNED_IN_FOR_TESTS));

    expect(ofAnn.activities).toEqual([
      expect.objectContaining({
        subject: { kind: "chat", threadId, roleKey: "cto", title: "Plan the quarter" },
        link: { kind: "chat", roleKey: "cto", threadId },
      }),
    ]);
    expect(ofBen.activities).toEqual([]);
  });

  it("answers each Off-board Task as its own kind, with its state, Stage, tokens and place", async () => {
    const onboardId = randomUUID();
    const setUpId = randomUUID();
    app.get(ActivityOffBoardTasksForTests).offBoardTasks = [
      {
        taskId: onboardId,
        projectId,
        title: "Onboard office",
        kind: "onboard",
        status: { state: "queued", place: 1, shortReasons: ["Project limit reached (1)"] },
        currentStage: undefined,
        since: new Date("2026-11-21T11:30:00Z"),
        tokens: 0,
      },
      {
        taskId: setUpId,
        projectId,
        title: "Set up the run environment",
        kind: "run-environment-setup",
        status: { state: "failed", stageName: "Verify" },
        currentStage: "Verify",
        since: new Date("2026-11-21T10:30:00Z"),
        tokens: 1_400_000,
      },
    ];

    const activity = await readActivity();

    const offBoard = activity.otherWork.filter(
      (item) => "taskId" in item && (item.taskId === onboardId || item.taskId === setUpId),
    );
    expect(offBoard).toEqual([
      expect.objectContaining({
        kind: "onboarding",
        id: `onboarding:${onboardId}`,
        state: "queued",
        stageName: null,
        tokens: 0,
        queued: { place: 1, shortReasons: ["Project limit reached (1)"] },
      }),
      expect.objectContaining({
        kind: "run-environment-set-up",
        id: `run-environment-set-up:${setUpId}`,
        state: "failed",
        stageName: "Verify",
        tokens: 1_400_000,
        queued: null,
      }),
    ]);
  });
});

describe("activity.changed", () => {
  it("reaches the web with nothing but its type", () => {
    const webEvent = app.get(WebEventForwarding).toWebEvent(new ActivityChanged());

    expect(activityWebEventSchema.parse(webEvent)).toEqual({
      type: "activity.changed",
      occurredAt: expect.any(String),
    });
  });
});
