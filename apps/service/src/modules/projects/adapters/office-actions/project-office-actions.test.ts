import {
  ciRunRerunSchema,
  projectRefusalSchema,
  RERUN_CI_RUN_ACTION,
  START_WORKFLOW_ACTION,
  workflowStartSchema,
} from "@the-office/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { anOfficeToolCall } from "../../../engine/index.fixtures.js";
import { FOLLOW_YOUR_AUTHORITY, OfficeToolRegistry } from "../../../engine/index.js";
import { FakeGitHub, signedInWithGitHubForTests } from "../../../github/index.fixtures.js";
import { ActionWorkflows } from "../../application/action-workflows.js";
import { CiRunTestbed, REPOSITORY } from "../../ci-run-watch.fixtures.js";
import type { Project } from "../../domain/project.js";
import { REAL_GIT_TEST } from "../git/temporary-repository.fixtures.js";

const FAILED_RUN = 4242;

/** A release workflow started by hand, declaring a start by hand on main and v1.2.0 alike. */
const RELEASE_YAML = `
name: Release
on:
  workflow_dispatch:
    inputs:
      channel:
        type: choice
        required: true
        options: [beta, stable]
      dry-run:
        type: boolean
        default: false
      notes:
        type: string
jobs: {}
`;

let github: FakeGitHub;
let testbed: CiRunTestbed;
let project: Project;

beforeEach(async () => {
  github = await FakeGitHub.start();
  github.installations.install("office", [{ fullName: REPOSITORY }]);
  github.runs.addRun(REPOSITORY, {
    id: FAILED_RUN,
    name: "CI",
    runNumber: 12,
    conclusion: "failure",
  });
  github.runs.addRun(REPOSITORY, { id: 4243, name: "CI", runNumber: 13 });
  testbed = await CiRunTestbed.create({
    urls: github.urls,
    signIn: signedInWithGitHubForTests(github.issueUserToken()),
  });
  project = await testbed.aProject();
  await testbed.runRound();
});

afterEach(async () => {
  await testbed.close();
  await github.close();
});

function rerun(runId: number, jobs: "all" | "failed"): Promise<Response> {
  return fetch(`${testbed.url}/api/projects/${project.id}/ci-runs/${runId}/rerun`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jobs }),
  });
}

function start(workflow: string, ref: string, inputs: Record<string, string>): Promise<Response> {
  return fetch(`${testbed.url}/api/projects/${project.id}/workflows/${workflow}/start`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ref, inputs }),
  });
}

async function refusalOf(response: Response): Promise<readonly string[]> {
  expect(response.status).toBe(422);
  return projectRefusalSchema.parse(await response.json()).reasons;
}

describe("the rerun_ci_run Office tool", REAL_GIT_TEST, () => {
  it("is registered, covered by onboarding Projects, and says the Role's authority gates it", () => {
    const registry = testbed.app.get(OfficeToolRegistry);

    expect(registry.coveredBy(["onboards-projects"])).toEqual([
      RERUN_CI_RUN_ACTION.name,
      START_WORKFLOW_ACTION.name,
    ]);
    expect(registry.named([RERUN_CI_RUN_ACTION.name])).toEqual([
      expect.objectContaining({
        description: `${RERUN_CI_RUN_ACTION.description} ${FOLLOW_YOUR_AUTHORITY}`,
        coveredBy: RERUN_CI_RUN_ACTION.coveredBy,
      }),
    ]);
  });
});

describe("rerun_ci_run", REAL_GIT_TEST, () => {
  it("re-runs a failed run's failed jobs on GitHub, then lists it queued with its next attempt", async () => {
    github.installations.grant("office", { actions: "write" });

    const response = await rerun(FAILED_RUN, "failed");

    expect(response.status).toBe(200);
    expect(ciRunRerunSchema.parse(await response.json())).toEqual({
      projectId: project.id,
      runId: FAILED_RUN,
      jobs: "failed",
    });
    expect(
      github.requests.filter(
        ({ method, path }) =>
          method === "POST" &&
          path === `/api/v3/repos/${REPOSITORY}/actions/runs/${FAILED_RUN}/rerun-failed-jobs`,
      ),
    ).toHaveLength(1);
    expect(testbed.watch.list(project.id).runs).toContainEqual(
      expect.objectContaining({ id: FAILED_RUN, status: "queued", attempt: 2 }),
    );
  });

  it("answers the Agent in plain words", async () => {
    github.installations.grant("office", { actions: "write" });

    const answer = await testbed
      .tool(RERUN_CI_RUN_ACTION.name)
      .run({ projectId: project.id, runId: FAILED_RUN, jobs: "all" }, anOfficeToolCall("s-1"));

    expect(answer).toEqual({
      isError: false,
      text: `CI run CI #12 of "${project.name}" runs again, all its jobs.`,
    });
  });

  it("refuses a run that didn't fail, asking GitHub nothing", async () => {
    const reasons = await refusalOf(await rerun(4243, "all"));

    expect(reasons).toEqual([
      "CI #13 is succeeded, so it can't be re-run: only a failed or cancelled CI run can.",
    ]);
    expect(github.requests.filter(({ method }) => method === "POST")).toEqual([]);
  });

  it("refuses a run the Project doesn't have", async () => {
    const reasons = await refusalOf(await rerun(9999, "all"));

    expect(reasons).toEqual([
      `"${project.name}" has no CI run 9999 among its recent runs on GitHub.`,
    ]);
  });

  it("refuses in GitHub's plain words when the App can't write Actions", async () => {
    const reasons = await refusalOf(await rerun(FAILED_RUN, "failed"));

    expect(reasons).toEqual([
      `GitHub refused to re-run run ${FAILED_RUN} of ${REPOSITORY} (HTTP 403): Resource not accessible by integration`,
    ]);
    expect(testbed.watch.list(project.id).runs).toContainEqual(
      expect.objectContaining({ id: FAILED_RUN, status: "failed", attempt: 1 }),
    );
  });
});

/** The refusal of release.yml while the Action Release, leaving the workstation, starts it. */
function releaseRefusal(): string {
  return `release.yml is started by the Action Release, from «${project.name}»'s Actions.`;
}

describe("start_workflow", REAL_GIT_TEST, () => {
  beforeEach(() => {
    github.workflows.addWorkflow(REPOSITORY, {
      file: "release.yml",
      name: "Release",
      yaml: RELEASE_YAML,
    });
    github.workflows.addWorkflow(REPOSITORY, {
      file: "ci.yml",
      name: "CI",
      yaml: { main: "on: push\njobs: {}\n", "v1.2.0": RELEASE_YAML },
    });
    github.workflows.addRef(REPOSITORY, { tag: "v1.2.0" });
  });

  it("starts the Workflow on GitHub with its inputs as text and their defaults, then lists the run it queued", async () => {
    github.installations.grant("office", { actions: "write" });
    const expectRun = vi.spyOn(testbed.watch, "expectRun");

    const response = await start("release.yml", "v1.2.0", { channel: "beta" });

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
        inputs: { channel: "beta", "dry-run": "false" },
      },
    ]);
    expect(expectRun).toHaveBeenCalledWith(project.id);
    expect(testbed.watch.list(project.id).runs).toContainEqual(
      expect.objectContaining({ workflow: "Release", branch: "v1.2.0", status: "queued" }),
    );
  });

  it("answers the Agent in plain words", async () => {
    github.installations.grant("office", { actions: "write" });

    const answer = await testbed.tool(START_WORKFLOW_ACTION.name).run(
      {
        projectId: project.id,
        workflow: "release.yml",
        ref: "main",
        inputs: { channel: "stable" },
      },
      anOfficeToolCall("s-1"),
    );

    expect(answer).toEqual({
      isError: false,
      text: `Workflow Release (release.yml) of "${project.name}" starts on main; its run shows in Work › CI once the code host lists it.`,
    });
  });

  it("refuses an input the Workflow doesn't declare, asking GitHub to start nothing", async () => {
    github.installations.grant("office", { actions: "write" });

    const reasons = await refusalOf(
      await start("release.yml", "main", { channel: "beta", flavour: "mint" }),
    );

    expect(reasons).toEqual(["release.yml has no input named flavour."]);
    expect(github.workflows.dispatches()).toEqual([]);
  });

  it("refuses a Workflow that can't be started by hand at the ref", async () => {
    github.installations.grant("office", { actions: "write" });

    const reasons = await refusalOf(await start("ci.yml", "main", {}));

    expect(reasons).toEqual([
      "ci.yml can't be started by hand on main: it has no workflow_dispatch there.",
    ]);
    expect(github.workflows.dispatches()).toEqual([]);
  });

  describe("a Workflow an Action that leaves the workstation starts", () => {
    beforeEach(() => {
      github.installations.grant("office", { actions: "write" });
      testbed.actions.keep(project.id, [
        {
          key: "release",
          name: "Release",
          kind: "workflow",
          settings: { file: ".github/workflows/release.yml", inputs: { channel: "stable" } },
          leavesTheWorkstation: true,
          setBy: {},
        },
      ]);
    });

    it("is refused to the user's Start a workflow, whatever its inputs, asking GitHub nothing", async () => {
      const reasons = await refusalOf(
        await start("release.yml", "main", { channel: "beta", "dry-run": "true" }),
      );

      expect(reasons).toEqual([releaseRefusal()]);
      expect(github.workflows.dispatches()).toEqual([]);
    });

    it("is refused to an Agent's start_workflow, naming the Action", async () => {
      const answer = await testbed
        .tool(START_WORKFLOW_ACTION.name)
        .run(
          { projectId: project.id, workflow: "release.yml", ref: "main", inputs: {} },
          anOfficeToolCall("s-1"),
        );

      expect(answer).toEqual({ isError: true, text: releaseRefusal() });
      expect(github.workflows.dispatches()).toEqual([]);
    });

    it("starts once the Action no longer leaves the workstation", async () => {
      testbed.actions.keep(project.id, [
        {
          key: "release",
          name: "Release",
          kind: "workflow",
          settings: { file: "release.yml", inputs: {} },
          leavesTheWorkstation: false,
          setBy: {},
        },
      ]);

      const response = await start("release.yml", "main", { channel: "beta" });

      expect(response.status).toBe(200);
    });

    describe("while the Project's Actions are switched off", () => {
      beforeEach(() => {
        project = { ...project, features: { actions: false } };
        testbed.replace(project);
      });

      it("is started by the user's Start a workflow: the guard is lifted", async () => {
        const response = await start("release.yml", "main", { channel: "beta" });

        expect(response.status).toBe(200);
        expect(github.workflows.dispatches()).toMatchObject([{ file: "release.yml", ref: "main" }]);
      });

      it("is started by an Agent's start_workflow too", async () => {
        const answer = await testbed.tool(START_WORKFLOW_ACTION.name).run(
          {
            projectId: project.id,
            workflow: "release.yml",
            ref: "main",
            inputs: { channel: "beta" },
          },
          anOfficeToolCall("s-1"),
        );

        expect(answer.isError).toBe(false);
        expect(github.workflows.dispatches()).toHaveLength(1);
      });

      it("is refused again once they are switched back on", async () => {
        testbed.replace({ ...project, features: { actions: true } });

        const reasons = await refusalOf(await start("release.yml", "main", { channel: "beta" }));

        expect(reasons).toEqual([releaseRefusal()]);
      });
    });

    describe("started by the Action's own run (ActionWorkflows)", () => {
      it("starts with the Action's inputs past the guard, then finds its CI run and follows it", async () => {
        const workflows = testbed.app.get(ActionWorkflows);

        const started = await workflows.start(project.id, "release.yml", "main", {
          channel: "stable",
        });

        expect(started).toMatchObject({
          workflowId: "release.yml",
          workflowName: "Release",
          hostName: "GitHub",
          runsUrl: `${github.urls.web}/${REPOSITORY}/actions/workflows/release.yml`,
        });
        expect(github.workflows.dispatches()).toEqual([
          {
            repository: REPOSITORY,
            file: "release.yml",
            ref: "main",
            inputs: { channel: "stable", "dry-run": "false" },
          },
        ]);
        const [run, ...more] = await workflows.runsStartedByHand(
          project.id,
          "release.yml",
          "main",
          started.askedAt,
        );
        expect(run).toMatchObject({ workflowName: "Release", status: "queued" });
        expect(more).toEqual([]);
        expect(
          await workflows.runsStartedByHand(
            project.id,
            "release.yml",
            "fix-login",
            started.askedAt,
          ),
        ).toEqual([]);
        github.runs.setRun(REPOSITORY, run?.id ?? 0, {
          status: "completed",
          conclusion: "failure",
        });
        await expect(workflows.ciRunOf(project.id, run?.id ?? 0)).resolves.toMatchObject({
          id: run?.id,
          status: "failed",
        });
      });
    });
  });

  it("refuses in GitHub's plain words when the App can't write Actions", async () => {
    const reasons = await refusalOf(await start("ci.yml", "v1.2.0", { channel: "beta" }));

    expect(reasons).toEqual([
      `GitHub refused to start ci.yml on v1.2.0 in ${REPOSITORY} (HTTP 403): Resource not accessible by integration`,
    ]);
  });
});
