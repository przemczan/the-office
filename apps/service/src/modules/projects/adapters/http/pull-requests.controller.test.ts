import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import {
  pullRequestListSchema,
  pullRequestMergeMethodsSchema,
  pullRequestRefusalSchema,
} from "@the-office/contracts";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import { SIGNED_IN_FOR_TESTS } from "../../../../platform/http/signed-in-requests.fixtures.js";
import type { SignedInUser } from "../../../../platform/http/signed-in-requests.js";
import {
  PullRequestActions,
  type MergeMethodsOffer,
} from "../../application/pull-request-actions.js";
import { PullRequestWatch, type PullRequestList } from "../../application/pull-request-watch.js";
import type { MergeMethod } from "../../domain/merge-method.js";
import { PullRequestNotFound, PullRequestRefused } from "../../domain/pull-request-refused.js";
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

/** The actions as the routes use them: each asked, and the refusal a test sets. */
class ActionsForTests {
  asked: unknown[][] = [];
  refusal: Error | undefined = undefined;

  mergeMethods(id: string): Promise<MergeMethodsOffer> {
    this.asked.push(["mergeMethods", id]);
    if (this.refusal) return Promise.reject(this.refusal);
    return Promise.resolve({
      allowed: ["merge", "squash"],
      recommended: "squash",
      warning: undefined,
      deletesBranchOnMerge: undefined,
    });
  }

  merge(id: string, method: MergeMethod, by: SignedInUser): Promise<void> {
    this.asked.push(["merge", id, method, by]);
    return this.refusal ? Promise.reject(this.refusal) : Promise.resolve();
  }

  close(id: string, by: SignedInUser): Promise<void> {
    this.asked.push(["close", id, by]);
    return this.refusal ? Promise.reject(this.refusal) : Promise.resolve();
  }
}

let app: INestApplication;
let url: string;
let watch: WatchForTests;
let actions: ActionsForTests;

beforeAll(async () => {
  watch = new WatchForTests();
  actions = new ActionsForTests();
  ({ app, url } = await startTestApplication({
    controllers: [PullRequestsController],
    providers: [
      { provide: PullRequestWatch, useValue: watch },
      { provide: PullRequestActions, useValue: actions },
    ],
  }));
});

beforeEach(() => {
  watch.refreshes = 0;
  watch.listedFor = [];
  actions.asked = [];
  actions.refusal = undefined;
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

const USER = { userId: SIGNED_IN_FOR_TESTS.userId, name: SIGNED_IN_FOR_TESTS.name };

function post(path: string, body?: unknown): Promise<Response> {
  return fetch(`${url}/api/pull-requests/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("GET /api/pull-requests/:id/merge-methods", () => {
  it("answers the allowed methods and the one picked first", async () => {
    const response = await fetch(`${url}/api/pull-requests/${OPEN.id}/merge-methods`);

    expect(response.status).toBe(200);
    expect(pullRequestMergeMethodsSchema.parse(await response.json())).toEqual({
      allowed: ["merge", "squash"],
      recommended: "squash",
      warning: null,
      deletesBranchOnMerge: null,
    });
  });

  it("answers 404 for a pull request not kept and 400 for an id that isn't one", async () => {
    actions.refusal = new PullRequestNotFound(OPEN.id);
    expect((await fetch(`${url}/api/pull-requests/${OPEN.id}/merge-methods`)).status).toBe(404);
    expect((await fetch(`${url}/api/pull-requests/seven/merge-methods`)).status).toBe(400);
  });
});

describe("POST /api/pull-requests/:id/merge", () => {
  it("merges by the method given, as the signed-in user", async () => {
    const response = await post(`${OPEN.id}/merge`, { method: "rebase" });

    expect(response.status).toBe(204);
    expect(actions.asked).toEqual([["merge", OPEN.id, "rebase", USER]]);
  });

  it("refuses a method that isn't one", async () => {
    const response = await post(`${OPEN.id}/merge`, { method: "octopus" });

    expect(response.status).toBe(400);
    expect(actions.asked).toEqual([]);
  });

  it("answers a refusal 409 with why and whether to refresh", async () => {
    actions.refusal = new PullRequestRefused("The branch moved since The Office read it.", true);

    const response = await post(`${OPEN.id}/merge`, { method: "squash" });

    expect(response.status).toBe(409);
    expect(pullRequestRefusalSchema.parse(await response.json())).toEqual({
      reason: "The branch moved since The Office read it.",
      refresh: true,
    });
  });
});

describe("POST /api/pull-requests/:id/close", () => {
  it("closes it as the signed-in user", async () => {
    const response = await post(`${OPEN.id}/close`);

    expect(response.status).toBe(204);
    expect(actions.asked).toEqual([["close", OPEN.id, USER]]);
  });

  it("answers a refusal 409", async () => {
    actions.refusal = new PullRequestRefused("Pull request #7 is already merged.", true);

    const response = await post(`${OPEN.id}/close`);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      reason: "Pull request #7 is already merged.",
      refresh: true,
    });
  });
});
