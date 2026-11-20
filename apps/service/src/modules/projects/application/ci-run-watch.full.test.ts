import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeGitHub, signedInWithGitHubForTests } from "../../github/index.fixtures.js";
import { REAL_GIT_TEST } from "../adapters/git/temporary-repository.fixtures.js";
import { CiRunTestbed, REPOSITORY } from "../ci-run-watch.fixtures.js";
import { CiRunsChecked } from "../domain/ci-run-events.js";
import { IDLE_CI_RUNS_EVERY } from "./ci-run-watch.js";

let github: FakeGitHub;
let gitHubDown: boolean;
let testbed: CiRunTestbed;

beforeEach(async () => {
  github = await FakeGitHub.start();
  gitHubDown = false;
  github.installations.install("office", [{ fullName: REPOSITORY }]);
  testbed = await CiRunTestbed.create({
    urls: github.urls,
    signIn: signedInWithGitHubForTests(github.issueUserToken()),
  });
  testbed.schedule.setTime(new Date("2026-11-19T10:00:00Z"));
});

afterEach(async () => {
  await testbed.close();
  if (!gitHubDown) await github.close();
});

describe("the CI run watch", REAL_GIT_TEST, () => {
  it("keeps the last runs while GitHub can't be reached, holding the problem until it can", async () => {
    github.runs.addRun(REPOSITORY, { id: 1, conclusion: "failure" });
    const project = await testbed.aProject();
    await testbed.runRound();
    const checkedAt = testbed.schedule.now();

    gitHubDown = true;
    await github.close();
    await testbed.schedule.advanceBy(IDLE_CI_RUNS_EVERY);
    await testbed.runRound();
    await testbed.schedule.advanceBy(IDLE_CI_RUNS_EVERY);
    await testbed.runRound();

    const { runs, projects } = testbed.watch.list(project.id);
    expect(runs).toEqual([expect.objectContaining({ id: 1, status: "failed" })]);
    expect(projects).toEqual([
      {
        projectId: project.id,
        checkedAt,
        stale: true,
        problem: {
          kind: "cannot-read",
          text: expect.stringContaining("GitHub couldn't be reached") as string,
        },
      },
    ]);
    // Listed, then gone stale with its problem, then still failing: news twice, not three times.
    expect(testbed.published.filter((event) => event instanceof CiRunsChecked)).toHaveLength(2);
  });
});
