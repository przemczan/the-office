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
  // Both users are every test's, and the seen table every file's: each test's items are its own.
  projectId = randomUUID();
  taskId = randomUUID();
  app.get(ActivityTasksForTests).tasks = [
    activityTask({ id: taskId, projectId, createdAt: new Date("2026-11-21T09:00:00Z") }),
  ];
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

function markSeen(body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(`${url}/api/activity/seen`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("GET /activity", () => {
  it("answers the items, the running first, each since it entered its state, and the count", async () => {
    const activity = await readActivity();

    expect(activity.items.map(({ kind, since, ended }) => ({ kind, since, ended }))).toEqual([
      { kind: "task", since: "2026-11-21T09:00:00.000Z", ended: false },
      { kind: "connected-device", since: "2026-11-21T08:00:00.000Z", ended: false },
      { kind: "ci-run", since: "2026-11-21T11:00:00.000Z", ended: true },
    ]);
    expect(activity.items[2]).toMatchObject({
      id: `ci-run:${projectId}:41:1:ended`,
      status: "failed",
      endedAt: "2026-11-21T11:00:00.000Z",
      link: { kind: "url", url: "https://github.com/acme/office/actions/runs/41" },
    });
    expect(activity.count).toBe(3);
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

    const offBoard = activity.items.filter(
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
        endedAt: null,
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

describe("POST /activity/seen", () => {
  it("leaves the ended items out for the user who saw them only, and never a running one", async () => {
    const response = await markSeen(
      { itemIds: [`ci-run:${projectId}:41:1:ended`, `task:${taskId}`] },
      signedInAs(ANOTHER_SIGNED_IN_FOR_TESTS),
    );

    expect(response.status).toBe(204);
    const ofBen = await readActivity(signedInAs(ANOTHER_SIGNED_IN_FOR_TESTS));
    expect(ofBen.items.map(({ kind }) => kind)).toEqual(["task", "connected-device"]);
    expect(ofBen.count).toBe(2);
    const ofAnn = await readActivity(signedInAs(SIGNED_IN_FOR_TESTS));
    expect(ofAnn.items.map(({ kind }) => kind)).toEqual(["task", "connected-device", "ci-run"]);
    expect(ofAnn.count).toBe(3);
  });

  it("refuses a request with no items", async () => {
    const response = await markSeen({ itemIds: [] });

    expect(response.status).toBe(400);
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
