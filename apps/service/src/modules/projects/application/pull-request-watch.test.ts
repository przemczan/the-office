import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeGitHub, signedInWithGitHubForTests } from "../../github/index.fixtures.js";
import type { DomainEvent } from "../../../platform/events/domain-event.js";
import { REAL_GIT_TEST } from "../adapters/git/temporary-repository.fixtures.js";
import { openedPullRequest } from "../domain/pull-request.js";
import {
  onTheCodeHost,
  PullRequestClosed,
  PullRequestMerged,
  PullRequestReopened,
  PullRequestsChecked,
} from "../domain/pull-request-events.js";
import { PostgresPullRequestRepository } from "../adapters/postgres/postgres-pull-request-repository.js";
import { REPOSITORY, PullRequestWatchTestbed } from "../pull-request-watch.fixtures.js";
import { PullRequestRecords } from "./pull-request-records.js";

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
async function aPublishedPullRequest(): Promise<{ id: string; number: number; taskId: string }> {
  const taskId = randomUUID();
  const branch = `office/${taskId}`;
  const { number, url } = await testbed.open(branch);
  const { id } = await testbed.records.record(
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
  return { id, number, taskId };
}

/** How many times pull request `number`'s status was read from GitHub. */
function statusReadsOf(number: number): number {
  const path = `/api/v3/repos/${REPOSITORY}/pulls/${number}`;
  return github.requests.filter((request) => request.path === path).length;
}

function endedEvents(): DomainEvent[] {
  return testbed.published.filter(
    (event) => event instanceof PullRequestMerged || event instanceof PullRequestClosed,
  );
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

  it("announces a pull request merged or closed on GitHub once, by the code host", async () => {
    const merged = await aPublishedPullRequest();
    const closed = await aPublishedPullRequest();
    await testbed.runRound();

    github.pullRequests.merge(REPOSITORY, merged.number);
    github.pullRequests.close(REPOSITORY, closed.number);
    await testbed.runRound();
    await testbed.runRound();

    expect(endedEvents()).toHaveLength(2);
    expect(endedEvents().find((event) => event instanceof PullRequestMerged)).toMatchObject({
      pullRequestId: merged.id,
      taskId: merged.taskId,
      number: merged.number,
      method: undefined,
      by: onTheCodeHost("GitHub"),
    });
    expect(endedEvents().find((event) => event instanceof PullRequestClosed)).toMatchObject({
      pullRequestId: closed.id,
      by: onTheCodeHost("GitHub"),
    });
    await expect(testbed.records.findById(closed.id)).resolves.toMatchObject({
      state: "closed",
      endedAt: expect.any(Date),
    });
  });

  it("announces nothing when the page's Merge ended the row while the round read it", async () => {
    const merged = await aPublishedPullRequest();
    await testbed.runRound();
    github.pullRequests.merge(REPOSITORY, merged.number);
    const endedByThePage = new Date("2026-11-19T10:00:00Z");
    // The round lists the row open; the page's Merge ends it before the round reads GitHub.
    vi.spyOn(testbed.records, "listOpen").mockImplementationOnce(async (projectId) => {
      const listed = await PostgresPullRequestRepository.prototype.listOpen.call(
        testbed.records,
        projectId,
      );
      await testbed.records.end(merged.id, "merged", endedByThePage);
      return listed;
    });

    await testbed.runRound();

    expect(endedEvents()).toEqual([]);
    await expect(testbed.records.findById(merged.id)).resolves.toMatchObject({
      state: "merged",
      endedAt: endedByThePage,
    });
  });

  it("doesn't open again a row the page's Merge ended after GitHub listed it open", async () => {
    const merged = await aPublishedPullRequest();
    // The round lists the pull request open; the page's Merge ends it before the round finds it.
    vi.spyOn(testbed.records, "listOpen").mockResolvedValueOnce([]);
    vi.spyOn(testbed.records, "find").mockImplementationOnce(async (remoteUrl, number) => {
      github.pullRequests.merge(REPOSITORY, merged.number);
      await testbed.records.end(merged.id, "merged", new Date());
      return PostgresPullRequestRepository.prototype.find.call(testbed.records, remoteUrl, number);
    });

    await testbed.runRound();

    expect(testbed.published.filter((event) => event instanceof PullRequestReopened)).toEqual([]);
    await expect(testbed.records.findById(merged.id)).resolves.toMatchObject({ state: "merged" });
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

describe("the pull requests needing attention, for Now", REAL_GIT_TEST, () => {
  it("lists the open ones whose checks fail or which have conflicts, oldest first", async () => {
    const failing = await aPublishedPullRequest();
    const conflicting = await aPublishedPullRequest();
    const passing = await aPublishedPullRequest();
    const merged = await aPublishedPullRequest();
    const closed = await aPublishedPullRequest();
    github.pullRequests.setChecks(REPOSITORY, failing.number, "failing");
    github.pullRequests.setMergeable(REPOSITORY, conflicting.number, false);
    github.pullRequests.setChecks(REPOSITORY, passing.number, "passing");
    for (const { number } of [merged, closed]) {
      github.pullRequests.setChecks(REPOSITORY, number, "failing");
    }
    await testbed.runRound();
    github.pullRequests.merge(REPOSITORY, merged.number);
    github.pullRequests.close(REPOSITORY, closed.number);
    await testbed.runRound();

    const ours = new Set([failing, conflicting, passing, merged, closed].map(({ id }) => id));
    const listed = (await new PullRequestRecords(testbed.records).needingAttention()).filter(
      ({ id }) => ours.has(id),
    );

    expect(listed.map(({ id }) => id).toSorted()).toEqual([failing.id, conflicting.id].toSorted());
    expect(listed.find(({ id }) => id === failing.id)).toMatchObject({
      projectId: testbed.project.id,
      taskId: failing.taskId,
      number: failing.number,
      checksFailing: true,
      conflicts: false,
      waitingSince: expect.any(Date),
    });
    expect(listed.find(({ id }) => id === conflicting.id)).toMatchObject({
      checksFailing: false,
      conflicts: true,
    });
    const since = listed.map(({ waitingSince }) => waitingSince.getTime());
    expect(since).toEqual(since.toSorted((one, other) => one - other));
  });
});
