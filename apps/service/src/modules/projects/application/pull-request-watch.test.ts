import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeGitHub, signedInWithGitHubForTests } from "../../github/index.fixtures.js";
import { REAL_GIT_TEST } from "../adapters/git/temporary-repository.fixtures.js";
import { openedPullRequest } from "../domain/pull-request.js";
import { PullRequestsChecked } from "../domain/pull-request-events.js";
import { REPOSITORY, PullRequestWatchTestbed } from "../pull-request-watch.fixtures.js";

let github: FakeGitHub;
let testbed: PullRequestWatchTestbed;

beforeEach(async () => {
  github = await FakeGitHub.start();
  github.installations.install("office", [{ fullName: REPOSITORY }]);
  testbed = await PullRequestWatchTestbed.create({
    urls: github.urls,
    signIn: signedInWithGitHubForTests(github.issueUserToken()),
  });
});

afterEach(async () => {
  await testbed.close();
  await github.close();
});

/** Opens a pull request of a Task's branch on GitHub and records it, as Publish does. */
async function aPublishedPullRequest(): Promise<{ number: number; taskId: string }> {
  const taskId = randomUUID();
  const branch = `office/${taskId}`;
  const { number, url } = await testbed.open(branch);
  await testbed.records.record(
    openedPullRequest({
      id: randomUUID(),
      projectId: testbed.project.id,
      taskId,
      remoteUrl: testbed.remoteUrl,
      number,
      url,
      title: "Rename a device",
      branch,
      baseBranch: "main",
      openedAt: new Date(),
    }),
  );
  return { number, taskId };
}

/** How many times pull request `number`'s status was read from GitHub. */
function statusReadsOf(number: number): number {
  const path = `/api/v3/repos/${REPOSITORY}/pulls/${number}`;
  return github.requests.filter((request) => request.path === path).length;
}

function checkedEvents(): number {
  return testbed.published.filter((event) => event instanceof PullRequestsChecked).length;
}

describe("the pull request watch", REAL_GIT_TEST, () => {
  it("reads each status once, then again only for the one whose commits moved", async () => {
    const first = await aPublishedPullRequest();
    const second = await aPublishedPullRequest();

    await testbed.runRound();

    expect(statusReadsOf(first.number)).toBe(1);
    expect(statusReadsOf(second.number)).toBe(1);
    expect(await testbed.records.listOpen(testbed.project.id)).toEqual([
      expect.objectContaining({ number: second.number, checks: "none", mergeable: "yes" }),
      expect.objectContaining({ number: first.number, checks: "none", mergeable: "yes" }),
    ]);
    expect(checkedEvents()).toBe(1);

    await testbed.runRound();

    expect(statusReadsOf(first.number)).toBe(1);
    expect(statusReadsOf(second.number)).toBe(1);
    expect(checkedEvents()).toBe(1);

    github.pullRequests.pushHead(REPOSITORY, second.number);
    github.pullRequests.setChecks(REPOSITORY, second.number, "failing");
    await testbed.runRound();

    expect(statusReadsOf(first.number)).toBe(1);
    expect(statusReadsOf(second.number)).toBe(2);
    await expect(testbed.records.find(testbed.remoteUrl, second.number)).resolves.toMatchObject({
      checks: "failing",
    });
    expect(checkedEvents()).toBe(2);
  });

  it("ends a merged pull request's row, so it leaves the list", async () => {
    const merged = await aPublishedPullRequest();
    const open = await aPublishedPullRequest();
    await testbed.runRound();

    github.pullRequests.merge(REPOSITORY, merged.number);
    await testbed.runRound();

    await expect(testbed.records.listOpen(testbed.project.id)).resolves.toEqual([
      expect.objectContaining({ number: open.number }),
    ]);
    await expect(testbed.records.find(testbed.remoteUrl, merged.number)).resolves.toMatchObject({
      state: "merged",
      endedAt: expect.any(Date),
    });
    expect(checkedEvents()).toBe(2);
  });

  it("marks the rows stale with no one signed in, holding why as the Project's problem", async () => {
    const published = await aPublishedPullRequest();
    await testbed.runRound();
    await testbed.signOut();

    await testbed.runRound();

    const { pullRequests, problems } = await testbed.watch.list(testbed.project.id);
    expect(pullRequests).toEqual([
      expect.objectContaining({ number: published.number, checks: "none", stale: true }),
    ]);
    expect(problems).toEqual([
      {
        kind: "cannot-read",
        projectId: testbed.project.id,
        text: expect.stringMatching(/no one is signed in\. Sign in with GitHub in Settings/),
      },
    ]);
    expect(checkedEvents()).toBe(2);

    await testbed.runRound();

    expect(checkedEvents()).toBe(2);
  });

  it("drops a removed Project's problem", async () => {
    await testbed.signOut();
    await testbed.runRound();
    expect((await testbed.watch.list(testbed.project.id)).problems).toHaveLength(1);

    testbed.removeProject();
    await testbed.runRound();

    expect((await testbed.watch.list(testbed.project.id)).problems).toEqual([]);
  });
});
