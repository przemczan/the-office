import { ciRunRerunSchema, projectRefusalSchema, RERUN_CI_RUN_ACTION } from "@the-office/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { anOfficeToolCall } from "../../../engine/index.fixtures.js";
import { FOLLOW_YOUR_AUTHORITY, OfficeToolRegistry } from "../../../engine/index.js";
import { FakeGitHub, signedInWithGitHubForTests } from "../../../github/index.fixtures.js";
import { CiRunTestbed, REPOSITORY } from "../../ci-run-watch.fixtures.js";
import type { Project } from "../../domain/project.js";
import { REAL_GIT_TEST } from "../git/temporary-repository.fixtures.js";

const FAILED_RUN = 4242;

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

async function refusalOf(response: Response): Promise<readonly string[]> {
  expect(response.status).toBe(422);
  return projectRefusalSchema.parse(await response.json()).reasons;
}

describe("the rerun_ci_run Office tool", REAL_GIT_TEST, () => {
  it("is registered, covered by onboarding Projects, and says the Role's authority gates it", () => {
    const registry = testbed.app.get(OfficeToolRegistry);

    expect(registry.coveredBy(["onboards-projects"])).toEqual([RERUN_CI_RUN_ACTION.name]);
    expect(registry.named([RERUN_CI_RUN_ACTION.name])).toEqual([
      expect.objectContaining({
        description: `${RERUN_CI_RUN_ACTION.description} ${FOLLOW_YOUR_AUTHORITY}`,
        coveredBy: RERUN_CI_RUN_ACTION.duties,
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
