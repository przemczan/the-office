import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import {
  ciRunListSchema,
  manualWorkflowListSchema,
  refListSchema,
  workflowStartSchema,
} from "@the-office/contracts";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import { FakeGitHub, signedInWithGitHubForTests } from "../../../github/index.fixtures.js";
import { CiRunWatch, type CiRunList } from "../../application/ci-run-watch.js";
import { ManualWorkflows } from "../../application/manual-workflows.js";
import { CiRunTestbed, REPOSITORY } from "../../ci-run-watch.fixtures.js";
import type { Project } from "../../domain/project.js";
import { REAL_GIT_TEST } from "../git/temporary-repository.fixtures.js";
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
    providers: [
      { provide: CiRunWatch, useValue: watch },
      // The Workflows started by hand are read on the fake GitHub below.
      { provide: ManualWorkflows, useValue: {} },
    ],
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

/** A Workflow declaring a start by hand with an input of each kind. */
const RELEASE_YAML = `
name: Release
on:
  workflow_dispatch:
    inputs:
      channel:
        type: choice
        description: Where it goes
        required: true
        options: [beta, stable]
      dry-run:
        type: boolean
        default: false
      shards:
        type: number
        default: 2
      notes:
        type: string
      target:
        type: environment
jobs: {}
`;

describe("the Workflows started by hand", REAL_GIT_TEST, () => {
  let github: FakeGitHub;
  let testbed: CiRunTestbed;
  let project: Project;

  beforeEach(async () => {
    github = await FakeGitHub.start();
    github.installations.install("office", [{ fullName: REPOSITORY }]);
    github.workflows.addWorkflow(REPOSITORY, {
      file: "release.yml",
      yaml: { "v1.2.0": RELEASE_YAML, main: "on: push\njobs: {}\n" },
    });
    github.workflows.addWorkflow(REPOSITORY, {
      file: "ci.yml",
      name: "CI",
      yaml: "on: push\njobs: {}\n",
    });
    github.workflows.addRef(REPOSITORY, { branch: "next" });
    github.workflows.addRef(REPOSITORY, { tag: "v1.2.0" });
    testbed = await CiRunTestbed.create({
      urls: github.urls,
      signIn: signedInWithGitHubForTests(github.issueUserToken()),
    });
    project = await testbed.aProject();
  });

  afterEach(async () => {
    await testbed.close();
    await github.close();
  });

  it("lists the Workflows that can be started by hand on a ref, with their inputs' kinds", async () => {
    const response = await fetch(`${testbed.url}/api/projects/${project.id}/workflows?ref=v1.2.0`);

    expect(response.status).toBe(200);
    expect(manualWorkflowListSchema.parse(await response.json())).toEqual({
      ref: "v1.2.0",
      workflows: [
        {
          id: "release.yml",
          name: "release.yml",
          url: expect.stringContaining("release.yml"),
          inputs: [
            {
              name: "channel",
              description: "Where it goes",
              required: true,
              default: null,
              kind: "choice",
              options: ["beta", "stable"],
            },
            expect.objectContaining({ name: "dry-run", kind: "yes-no", default: "false" }),
            expect.objectContaining({ name: "shards", kind: "number", default: "2" }),
            expect.objectContaining({ name: "notes", kind: "text", default: null }),
            expect.objectContaining({ name: "target", kind: "environment" }),
          ],
        },
      ],
      problem: null,
    });
  });

  it("lists them on the base branch when no ref is given", async () => {
    const response = await fetch(`${testbed.url}/api/projects/${project.id}/workflows`);

    expect(manualWorkflowListSchema.parse(await response.json())).toEqual({
      ref: "main",
      workflows: [],
      problem: null,
    });
  });

  it("lists the branches and tags with the Project's base branch", async () => {
    const response = await fetch(`${testbed.url}/api/projects/${project.id}/refs`);

    expect(response.status).toBe(200);
    expect(refListSchema.parse(await response.json())).toEqual({
      branches: ["main", "next"],
      tags: ["v1.2.0"],
      baseBranch: "main",
      problem: null,
    });
  });

  it("answers nothing with the problem in plain words while nobody is signed in", async () => {
    await testbed.signOut();
    const requestsBefore = github.requests.length;

    const workflows = await fetch(`${testbed.url}/api/projects/${project.id}/workflows?ref=v1.2.0`);
    const refs = await fetch(`${testbed.url}/api/projects/${project.id}/refs`);

    expect([workflows.status, refs.status]).toEqual([200, 200]);
    expect(manualWorkflowListSchema.parse(await workflows.json())).toEqual({
      ref: "v1.2.0",
      workflows: [],
      problem: expect.stringContaining("no one is signed in"),
    });
    expect(refListSchema.parse(await refs.json())).toEqual({
      branches: [],
      tags: [],
      baseBranch: "main",
      problem: expect.stringContaining("no one is signed in"),
    });
    expect(github.requests.length).toBe(requestsBefore);
  });

  it("answers 404 for a Project that isn't there", async () => {
    const response = await fetch(`${testbed.url}/api/projects/no-such-project/refs`);

    expect(response.status).toBe(404);
  });

  it("starts one with its inputs as text, and its queued run shows in the Project's CI runs", async () => {
    github.installations.grant("office", { actions: "write" });

    const response = await fetch(
      `${testbed.url}/api/projects/${project.id}/workflows/release.yml/start`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ref: "v1.2.0", inputs: { channel: "stable", shards: "3" } }),
      },
    );

    expect(response.status).toBe(200);
    expect(workflowStartSchema.parse(await response.json())).toEqual({
      projectId: project.id,
      workflow: "release.yml",
      ref: "v1.2.0",
    });
    expect(github.workflows.dispatches()).toEqual([
      {
        repository: REPOSITORY,
        file: "release.yml",
        ref: "v1.2.0",
        inputs: { channel: "stable", "dry-run": "false", shards: "3" },
      },
    ]);
    const listed = ciRunListSchema.parse(
      await (await fetch(`${testbed.url}/api/ci-runs?projectId=${project.id}`)).json(),
    );
    expect(listed.runs).toEqual([
      expect.objectContaining({
        workflow: "release.yml",
        trigger: "workflow_dispatch",
        status: "queued",
      }),
    ]);
  });
});
