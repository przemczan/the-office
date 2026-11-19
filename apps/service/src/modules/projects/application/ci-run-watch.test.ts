import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeGitHub, signedInWithGitHubForTests } from "../../github/index.fixtures.js";
import { REAL_GIT_TEST } from "../adapters/git/temporary-repository.fixtures.js";
import { CiRunTestbed, REPOSITORY } from "../ci-run-watch.fixtures.js";
import { CiRunsChecked } from "../domain/ci-run-events.js";
import {
  CI_REFRESH_AT_MOST_EVERY,
  CI_RUN_WATCH,
  CI_RUN_WATCH_EVERY,
  EXPECTED_RUN_WITHIN,
  IDLE_CI_RUNS_EVERY,
} from "./ci-run-watch.js";

/** A second repository on the fake GitHub, for a Project whose runs are idle. */
const IDLE_REPOSITORY = "office/site";

let github: FakeGitHub;
let testbed: CiRunTestbed;

beforeEach(async () => {
  github = await FakeGitHub.start();
  github.installations.install("office", [{ fullName: REPOSITORY }, { fullName: IDLE_REPOSITORY }]);
  testbed = await CiRunTestbed.create({
    urls: github.urls,
    signIn: signedInWithGitHubForTests(github.issueUserToken()),
  });
  testbed.schedule.setTime(new Date("2026-11-19T10:00:00Z"));
});

afterEach(async () => {
  await testbed.close();
  await github.close();
});

/** How many times the repository's runs were listed from GitHub. */
function listReads(repository = REPOSITORY): number {
  const path = `/api/v3/repos/${repository}/actions/runs`;
  return github.requests.filter((request) => request.method === "GET" && request.path === path)
    .length;
}

function checkedEvents(): CiRunsChecked[] {
  return testbed.published.filter((event) => event instanceof CiRunsChecked);
}

describe("the CI run watch", REAL_GIT_TEST, () => {
  it("lists a Project with a run going every 15 seconds, and an idle one every minute", async () => {
    github.runs.addRun(REPOSITORY, { id: 1, status: "in_progress", conclusion: null });
    github.runs.addRun(IDLE_REPOSITORY, { id: 2 });
    await testbed.aProject(REPOSITORY);
    await testbed.aProject(IDLE_REPOSITORY);
    expect(testbed.schedule.intervalOf(CI_RUN_WATCH)).toBe(CI_RUN_WATCH_EVERY);

    await testbed.runRound();
    expect([listReads(REPOSITORY), listReads(IDLE_REPOSITORY)]).toEqual([1, 1]);

    await testbed.schedule.advanceBy(CI_RUN_WATCH_EVERY);
    await testbed.runRound();
    expect([listReads(REPOSITORY), listReads(IDLE_REPOSITORY)]).toEqual([2, 1]);

    await testbed.schedule.advanceBy(IDLE_CI_RUNS_EVERY - CI_RUN_WATCH_EVERY);
    await testbed.runRound();
    expect([listReads(REPOSITORY), listReads(IDLE_REPOSITORY)]).toEqual([3, 2]);
  });

  it("answers the test's own Projects' runs newest first, each with its Task", async () => {
    const taskId = randomUUID();
    github.runs.addRun(REPOSITORY, { id: 10, startedAt: "2026-11-19T08:00:00Z" });
    github.runs.addRun(REPOSITORY, {
      id: 11,
      status: "completed",
      conclusion: "failure",
      headBranch: `office/${taskId}`,
      startedAt: "2026-11-19T09:00:00Z",
    });
    const project = await testbed.aProject();

    await testbed.runRound();

    const { runs, projects } = testbed.watch.list();
    expect(runs).toEqual([
      expect.objectContaining({ id: 11, projectId: project.id, status: "failed", taskId }),
      expect.objectContaining({ id: 10, projectId: project.id, status: "succeeded", taskId: null }),
    ]);
    expect(projects).toEqual([
      { projectId: project.id, checkedAt: testbed.schedule.now(), stale: false, problem: null },
    ]);
  });

  it("lets the runs go stale with no problem while nobody is signed in, asking GitHub nothing", async () => {
    github.runs.addRun(REPOSITORY, { id: 1 });
    const project = await testbed.aProject();
    await testbed.runRound();
    const checkedAt = testbed.schedule.now();

    await testbed.signOut();
    await testbed.schedule.advanceBy(IDLE_CI_RUNS_EVERY);
    await testbed.runRound();

    expect(listReads()).toBe(1);
    expect(testbed.watch.list(project.id)).toEqual({
      runs: [expect.objectContaining({ id: 1 })],
      projects: [{ projectId: project.id, checkedAt, stale: true, problem: null }],
    });
  });

  it("tells the web only when a Project's runs changed", async () => {
    github.runs.addRun(REPOSITORY, { id: 1 });
    const project = await testbed.aProject();

    await testbed.runRound();
    expect(checkedEvents()).toEqual([expect.objectContaining({ projectIds: [project.id] })]);

    await testbed.schedule.advanceBy(IDLE_CI_RUNS_EVERY);
    await testbed.runRound();
    expect(listReads()).toBe(2);
    expect(checkedEvents()).toHaveLength(1);

    github.runs.setRun(REPOSITORY, 1, {
      conclusion: "failure",
      updatedAt: "2026-11-19T10:01:00Z",
    });
    await testbed.schedule.advanceBy(IDLE_CI_RUNS_EVERY);
    await testbed.runRound();
    expect(checkedEvents()).toHaveLength(2);
  });

  it("refreshes at once when asked, at most once in a while, and never twice at once", async () => {
    const project = await testbed.aProject();
    await testbed.runRound();

    await Promise.all([testbed.watch.refresh(project.id), testbed.watch.refresh(project.id)]);
    expect(listReads()).toBe(2);

    await testbed.schedule.advanceBy(CI_REFRESH_AT_MOST_EVERY - 1);
    await testbed.watch.refresh(project.id);
    expect(listReads()).toBe(2);

    await testbed.watch.refresh(project.id, { force: true });
    expect(listReads()).toBe(3);

    await testbed.schedule.advanceBy(1);
    await testbed.watch.refresh(project.id);
    expect(listReads()).toBe(4);
  });

  it("lists a Project expecting a run every round for a minute, again from the start when asked again", async () => {
    github.runs.addRun(REPOSITORY, { id: 1 });
    const project = await testbed.aProject();
    await testbed.runRound();

    await testbed.watch.expectRun(project.id);
    expect(listReads()).toBe(2);

    /** Rounds by the clock, `CI_RUN_WATCH_EVERY` apart, until `ms` has passed. */
    async function roundsFor(ms: number): Promise<void> {
      for (let passed = 0; passed < ms; passed += CI_RUN_WATCH_EVERY) {
        await testbed.schedule.advanceBy(CI_RUN_WATCH_EVERY);
        await testbed.runRound();
      }
    }

    await roundsFor(2 * CI_RUN_WATCH_EVERY);
    expect(listReads()).toBe(4);

    await testbed.watch.expectRun(project.id);
    expect(listReads()).toBe(5);
    await roundsFor(EXPECTED_RUN_WITHIN);
    expect(listReads()).toBe(5 + EXPECTED_RUN_WITHIN / CI_RUN_WATCH_EVERY);

    // The window over, an idle Project waits its minute again.
    await roundsFor(CI_RUN_WATCH_EVERY);
    expect(listReads()).toBe(5 + EXPECTED_RUN_WITHIN / CI_RUN_WATCH_EVERY);
  });
});
