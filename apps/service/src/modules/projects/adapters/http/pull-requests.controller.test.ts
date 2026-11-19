import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { pullRequestListSchema } from "@the-office/contracts";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import { PullRequestWatch, type PullRequestList } from "../../application/pull-request-watch.js";
import { openedPullRequest, type PullRequest } from "../../domain/pull-request.js";
import { PullRequestsController } from "./pull-requests.controller.js";

const PROJECT = "admin-panel";
const TASK = randomUUID();

const OPEN: PullRequest = {
  ...openedPullRequest({
    id: randomUUID(),
    projectId: PROJECT,
    taskId: TASK,
    remoteUrl: "https://github.com/office/tools.git",
    number: 7,
    url: "https://github.com/office/tools/pull/7",
    title: "Rename a device",
    branch: `office/${TASK}`,
    baseBranch: "main",
    openedAt: new Date("2026-11-19T09:00:00.000Z"),
  }),
  checks: "failing",
  mergeable: "conflicts",
  checkedAt: new Date("2026-11-19T09:01:00.000Z"),
};

/** The watch as the routes use it: what it lists, and each refresh asked. */
class WatchForTests {
  refreshes = 0;
  listedFor: (string | undefined)[] = [];

  list(projectId?: string): Promise<PullRequestList> {
    this.listedFor.push(projectId);
    return Promise.resolve({
      pullRequests: [OPEN],
      problems: [
        {
          kind: "unreachable",
          projectId: PROJECT,
          codeHost: "GitHub",
          failedAt: new Date("2026-11-19T09:02:00.000Z"),
          lastReadAt: new Date("2026-11-19T09:01:00.000Z"),
        },
      ],
    });
  }

  refresh(): Promise<void> {
    this.refreshes += 1;
    return Promise.reject(new Error("GitHub is down, which the route doesn't wait for."));
  }
}

let app: INestApplication;
let url: string;
let watch: WatchForTests;

beforeAll(async () => {
  watch = new WatchForTests();
  ({ app, url } = await startTestApplication({
    controllers: [PullRequestsController],
    providers: [{ provide: PullRequestWatch, useValue: watch }],
  }));
});

beforeEach(() => {
  watch.refreshes = 0;
  watch.listedFor = [];
});

afterAll(async () => {
  await app.close();
});

describe("GET /api/pull-requests", () => {
  it("answers the open pull requests with their checks, merge state and problems", async () => {
    const response = await fetch(`${url}/api/pull-requests?projectId=${PROJECT}`);

    expect(response.status).toBe(200);
    expect(pullRequestListSchema.parse(await response.json())).toEqual({
      pullRequests: [
        {
          id: OPEN.id,
          projectId: PROJECT,
          taskId: TASK,
          number: 7,
          url: "https://github.com/office/tools/pull/7",
          title: "Rename a device",
          branch: `office/${TASK}`,
          baseBranch: "main",
          openedAt: "2026-11-19T09:00:00.000Z",
          checks: "failing",
          mergeable: "conflicts",
          checkedAt: "2026-11-19T09:01:00.000Z",
          stale: false,
        },
      ],
      problems: [
        {
          kind: "unreachable",
          projectId: PROJECT,
          codeHost: "GitHub",
          failedAt: "2026-11-19T09:02:00.000Z",
          lastReadAt: "2026-11-19T09:01:00.000Z",
        },
      ],
    });
    expect(watch.listedFor).toEqual([PROJECT]);
  });

  it("refuses an empty Project", async () => {
    const response = await fetch(`${url}/api/pull-requests?projectId=`);

    expect(response.status).toBe(400);
    expect(watch.listedFor).toEqual([]);
  });
});

describe("POST /api/pull-requests/refresh", () => {
  it("answers at once, without waiting for the refresh", async () => {
    const response = await fetch(`${url}/api/pull-requests/refresh`, { method: "POST" });

    expect(response.status).toBe(202);
    expect(watch.refreshes).toBe(1);
  });
});
