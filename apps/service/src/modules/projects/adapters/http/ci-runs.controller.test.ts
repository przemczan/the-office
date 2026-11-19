import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { ciRunListSchema } from "@the-office/contracts";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import { CiRunWatch, type CiRunList } from "../../application/ci-run-watch.js";
import { CiRunsController } from "./ci-runs.controller.js";

const PROJECT = "admin-panel";
const TASK = randomUUID();

/** The watch as the routes use it: what it lists, and each refresh asked. */
class WatchForTests {
  refreshedFor: (string | undefined)[] = [];
  listedFor: (string | undefined)[] = [];

  list(projectId?: string): CiRunList {
    this.listedFor.push(projectId);
    return {
      runs: [
        {
          id: 9001,
          projectId: PROJECT,
          number: 12,
          attempt: 2,
          workflow: "CI",
          title: "Rename a device",
          trigger: "pull_request",
          branch: `office/${TASK}`,
          commit: "c".repeat(40),
          status: "failed",
          startedAt: null,
          updatedAt: new Date("2026-11-19T09:05:00.000Z"),
          url: "https://github.com/office/tools/actions/runs/9001",
          taskId: TASK,
        },
      ],
      projects: [
        {
          projectId: PROJECT,
          checkedAt: new Date("2026-11-19T09:01:00.000Z"),
          stale: true,
          problem: {
            kind: "unreachable",
            codeHost: "GitHub",
            failedAt: new Date("2026-11-19T09:02:00.000Z"),
          },
        },
      ],
    };
  }

  refresh(projectId?: string): Promise<void> {
    this.refreshedFor.push(projectId);
    return Promise.reject(new Error("GitHub is down, which the route doesn't wait for."));
  }
}

let app: INestApplication;
let url: string;
let watch: WatchForTests;

beforeAll(async () => {
  watch = new WatchForTests();
  ({ app, url } = await startTestApplication({
    controllers: [CiRunsController],
    providers: [{ provide: CiRunWatch, useValue: watch }],
  }));
});

beforeEach(() => {
  watch.refreshedFor = [];
  watch.listedFor = [];
});

afterAll(async () => {
  await app.close();
});

describe("GET /api/ci-runs", () => {
  it("answers the runs with their Tasks, and where each Project's listing stands", async () => {
    const response = await fetch(`${url}/api/ci-runs?projectId=${PROJECT}`);

    expect(response.status).toBe(200);
    expect(ciRunListSchema.parse(await response.json())).toEqual({
      runs: [
        {
          id: 9001,
          projectId: PROJECT,
          number: 12,
          attempt: 2,
          workflow: "CI",
          title: "Rename a device",
          trigger: "pull_request",
          branch: `office/${TASK}`,
          commit: "c".repeat(40),
          status: "failed",
          startedAt: null,
          updatedAt: "2026-11-19T09:05:00.000Z",
          url: "https://github.com/office/tools/actions/runs/9001",
          taskId: TASK,
        },
      ],
      projects: [
        {
          projectId: PROJECT,
          checkedAt: "2026-11-19T09:01:00.000Z",
          stale: true,
          problem: {
            kind: "unreachable",
            codeHost: "GitHub",
            failedAt: "2026-11-19T09:02:00.000Z",
          },
        },
      ],
    });
    expect(watch.listedFor).toEqual([PROJECT]);
  });

  it("refuses an empty Project", async () => {
    const response = await fetch(`${url}/api/ci-runs?projectId=`);

    expect(response.status).toBe(400);
    expect(watch.listedFor).toEqual([]);
  });
});

describe("POST /api/ci-runs/refresh", () => {
  it("answers at once, without waiting for the refresh, for every Project or the one named", async () => {
    const every = await fetch(`${url}/api/ci-runs/refresh`, { method: "POST" });
    const one = await fetch(`${url}/api/ci-runs/refresh?projectId=${PROJECT}`, { method: "POST" });

    expect([every.status, one.status]).toEqual([202, 202]);
    expect(watch.refreshedFor).toEqual([undefined, PROJECT]);
  });
});
