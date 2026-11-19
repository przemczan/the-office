import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeGitHub, signedInWithGitHubForTests } from "../../github/index.fixtures.js";
import { REAL_GIT_TEST } from "../adapters/git/temporary-repository.fixtures.js";
import { PullRequestsChecked } from "../domain/pull-request-events.js";
import { REPOSITORY, PullRequestWatchTestbed } from "../pull-request-watch.fixtures.js";
import { REFRESH_AT_MOST_EVERY } from "./pull-request-watch.js";

let github: FakeGitHub;
let gitHubDown: boolean;
let testbed: PullRequestWatchTestbed;

beforeEach(async () => {
  github = await FakeGitHub.start();
  gitHubDown = false;
  github.installations.install("office", [{ fullName: REPOSITORY }]);
  testbed = await PullRequestWatchTestbed.create({
    urls: github.urls,
    signIn: signedInWithGitHubForTests(github.issueUserToken()),
  });
});

afterEach(async () => {
  await testbed.close();
  if (!gitHubDown) await github.close();
});

/** How many times the repository's open pull requests were listed from GitHub. */
function listReads(): number {
  const path = `/api/v3/repos/${REPOSITORY}/pulls`;
  return github.requests.filter((request) => request.method === "GET" && request.path === path)
    .length;
}

describe("the pull request watch", REAL_GIT_TEST, () => {
  it("adopts a pull request on a Task's branch that Publish didn't record, and no other", async () => {
    const taskId = randomUUID();
    const adopted = await testbed.open(`office/${taskId}`, "Rename a device");
    await testbed.open("someone-elses-branch", "Not The Office's");

    await testbed.runRound();

    await expect(testbed.records.listOpen(testbed.project.id)).resolves.toEqual([
      expect.objectContaining({
        projectId: testbed.project.id,
        taskId,
        number: adopted.number,
        url: adopted.url,
        title: "Rename a device",
        branch: `office/${taskId}`,
        baseBranch: "main",
        checks: "none",
        mergeable: "yes",
        stale: false,
      }),
    ]);
    expect(testbed.published.filter((event) => event instanceof PullRequestsChecked)).toEqual([
      expect.objectContaining({ projectIds: [testbed.project.id] }),
    ]);
  });

  it("keeps the last status while GitHub can't be reached, saying since when", async () => {
    const opened = await testbed.open(`office/${randomUUID()}`);
    github.pullRequests.setChecks(REPOSITORY, opened.number, "passing");
    await testbed.runRound();

    gitHubDown = true;
    await github.close();
    await testbed.runRound();

    const { pullRequests, problems } = await testbed.watch.list();
    expect(pullRequests.filter((one) => one.projectId === testbed.project.id)).toEqual([
      expect.objectContaining({ number: opened.number, checks: "passing", stale: true }),
    ]);
    expect(problems.filter((problem) => problem.projectId === testbed.project.id)).toEqual([
      {
        kind: "unreachable",
        projectId: testbed.project.id,
        codeHost: "GitHub",
        failedAt: expect.any(Date),
        lastReadAt: expect.any(Date),
      },
    ]);
  });

  it("refreshes at most once in a while, and never twice at once", async () => {
    await testbed.open(`office/${randomUUID()}`);
    testbed.schedule.setTime(new Date("2026-11-19T10:00:00Z"));

    await Promise.all([testbed.watch.refresh(), testbed.watch.refresh()]);
    expect(listReads()).toBe(1);

    await testbed.schedule.advanceBy(REFRESH_AT_MOST_EVERY - 1);
    await testbed.watch.refresh();
    expect(listReads()).toBe(1);

    await testbed.schedule.advanceBy(1);
    await testbed.watch.refresh();
    expect(listReads()).toBe(2);
  });
});
