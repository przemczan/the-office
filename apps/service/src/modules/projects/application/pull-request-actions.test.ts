import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import type { DomainEvent } from "../../../platform/events/domain-event.js";
import { EventBus } from "../../../platform/events/event-bus.js";
import { ManualSchedule } from "../../../platform/schedule/schedule.fixtures.js";
import type { ManualWorkflow } from "../domain/manual-workflow.js";
import { MERGE_METHODS, type MergeMethod } from "../domain/merge-method.js";
import {
  openedPullRequest,
  type PullRequest,
  type PullRequestStatus,
} from "../domain/pull-request.js";
import { PullRequestClosed, PullRequestMerged } from "../domain/pull-request-events.js";
import { PullRequestNotFound, PullRequestRefused } from "../domain/pull-request-refused.js";
import {
  CodeHost,
  CodeHostChangedSince,
  CodeHostRefused,
  type CiRunOnHost,
  type IssueOnHost,
  type FoundIssueOnHost,
  type MergedOnHost,
  type MergeMethodsOnHost,
  type MergeRequest,
  type OpenedPullRequest,
  type PullRequestOnHost,
  type RefsOnHost,
} from "../ports/code-host.js";
import { PullRequestRepositoryForTests } from "../ports/pull-request-repository.fixtures.js";
import { CodeHosts } from "./code-hosts.js";
import { PullRequestActions } from "./pull-request-actions.js";

const REMOTE = "https://github.com/office/tools.git";
const USER = { userId: randomUUID(), name: "Ada" };

/** A code host in memory that merges and closes, unless a test refuses. */
class MergingCodeHost extends CodeHost {
  readonly name = "GitHub";
  allowed: readonly MergeMethod[] = MERGE_METHODS;
  refusal: CodeHostRefused | undefined = undefined;
  readonly merges: { number: number; request: MergeRequest }[] = [];
  readonly closes: number[] = [];

  reaches(): boolean {
    return true;
  }
  whyCannotOpen(): Promise<string | undefined> {
    return Promise.resolve(undefined);
  }
  open(): Promise<OpenedPullRequest> {
    return Promise.reject(new Error("Not opened here."));
  }
  whyCannotRead(): Promise<string | undefined> {
    return Promise.resolve(undefined);
  }
  openPullRequests(): Promise<readonly PullRequestOnHost[]> {
    return Promise.resolve([]);
  }
  pullRequestStatus(): Promise<PullRequestStatus> {
    return Promise.reject(new Error("Not read here."));
  }
  mergeMethods(): Promise<MergeMethodsOnHost> {
    return Promise.resolve({ allowed: this.allowed, deletesBranchOnMerge: false });
  }
  async merge(_: string, number: number, request: MergeRequest): Promise<MergedOnHost> {
    if (this.refusal) throw this.refusal;
    this.merges.push({ number, request });
    return { commit: "c".repeat(40) };
  }
  async close(_: string, number: number): Promise<void> {
    if (this.refusal) throw this.refusal;
    this.closes.push(number);
  }
  recentRuns(): Promise<readonly CiRunOnHost[]> {
    return Promise.resolve([]);
  }
  rerun(): Promise<void> {
    return Promise.reject(new Error("Not re-run here."));
  }
  manualWorkflows(): Promise<readonly ManualWorkflow[]> {
    return Promise.resolve([]);
  }
  refs(): Promise<RefsOnHost> {
    return Promise.resolve({ branches: [], tags: [] });
  }
  startWorkflow(): Promise<void> {
    return Promise.reject(new Error("Not started here."));
  }

  openIssues(): Promise<readonly IssueOnHost[]> {
    return Promise.resolve([]);
  }

  issue(): Promise<FoundIssueOnHost | undefined> {
    return Promise.resolve(undefined);
  }

  commentOnIssue(): Promise<void> {
    return Promise.reject(new Error("Not commented here."));
  }

  closeIssue(): Promise<void> {
    return Promise.reject(new Error("Not closed here."));
  }
}

let records: PullRequestRepositoryForTests;
let host: MergingCodeHost;
let published: DomainEvent[];
let actions: PullRequestActions;
let schedule: ManualSchedule;

beforeEach(() => {
  records = new PullRequestRepositoryForTests();
  host = new MergingCodeHost();
  const events = new EventBus();
  published = [];
  events.subscribeToEveryEvent((event) => void published.push(event));
  schedule = new ManualSchedule();
  schedule.setTime(new Date("2026-11-19T10:00:00Z"));
  actions = new PullRequestActions(records, new CodeHosts([host]), events, schedule);
});

/** A pull request kept open, its status read at head `aaa…`. */
async function aKeptPullRequest(branch = `office/${randomUUID()}`): Promise<PullRequest> {
  return records.record({
    ...openedPullRequest({
      id: randomUUID(),
      projectId: "admin-panel",
      taskId: randomUUID(),
      remoteUrl: REMOTE,
      number: records.kept.size + 1,
      url: `https://github.com/office/tools/pull/${records.kept.size + 1}`,
      title: "Rename a device",
      branch,
      baseBranch: "main",
      openedAt: new Date("2026-11-19T09:00:00Z"),
    }),
    headCommit: "a".repeat(40),
    baseCommit: "b".repeat(40),
    checkedAt: new Date("2026-11-19T09:01:00Z"),
  });
}

describe("PullRequestActions", () => {
  it("offers the allowed methods, squash first for a Task's and merge for an Initiative's", async () => {
    const ofTask = await aKeptPullRequest();
    const ofInitiative = await aKeptPullRequest("initiative/devices");

    await expect(actions.mergeMethods(ofTask.id)).resolves.toEqual({
      allowed: MERGE_METHODS,
      recommended: "squash",
      warning: undefined,
      deletesBranchOnMerge: false,
    });
    host.allowed = ["squash", "rebase"];
    await expect(actions.mergeMethods(ofInitiative.id)).resolves.toMatchObject({
      recommended: "squash",
      warning: expect.stringMatching(/Initiative's commits/),
    });
  });

  it("merges at the head commit read last, ending the row with one event", async () => {
    const pullRequest = await aKeptPullRequest();

    await actions.merge(pullRequest.id, "squash", USER);

    expect(host.merges).toEqual([
      {
        number: pullRequest.number,
        request: { method: "squash", expectedHeadCommit: "a".repeat(40) },
      },
    ]);
    await expect(records.findById(pullRequest.id)).resolves.toMatchObject({
      state: "merged",
      endedAt: schedule.now(),
    });
    expect(published).toHaveLength(1);
    expect(published[0]).toBeInstanceOf(PullRequestMerged);
    expect(published).toEqual([
      expect.objectContaining({
        pullRequestId: pullRequest.id,
        method: "squash",
        by: { kind: "user", ...USER },
      }),
    ]);
  });

  it("announces nothing when the watch ended the row first", async () => {
    const pullRequest = await aKeptPullRequest();
    host.merge = async () => {
      await records.end(pullRequest.id, "merged", new Date());
      return { commit: "c".repeat(40) };
    };

    await actions.merge(pullRequest.id, "squash", USER);

    expect(published).toEqual([]);
  });

  it("leaves the row open when the host refuses, offering Refresh when it moved", async () => {
    const pullRequest = await aKeptPullRequest();
    host.refusal = new CodeHostChangedSince("The branch moved since The Office read it.");

    await expect(actions.merge(pullRequest.id, "squash", USER)).rejects.toEqual(
      new PullRequestRefused("The branch moved since The Office read it.", true),
    );
    host.refusal = new CodeHostRefused("Required checks haven't passed.");
    await expect(actions.merge(pullRequest.id, "squash", USER)).rejects.toMatchObject({
      reason: "Required checks haven't passed.",
      refresh: false,
    });

    await expect(records.findById(pullRequest.id)).resolves.toMatchObject({ endedAt: null });
    expect(published).toEqual([]);
  });

  it("refuses a method the repository doesn't allow and a status not read yet", async () => {
    const pullRequest = await aKeptPullRequest();
    host.allowed = ["merge"];

    await expect(actions.merge(pullRequest.id, "squash", USER)).rejects.toMatchObject({
      reason: expect.stringMatching(/doesn't allow merging by squashing/),
      refresh: false,
    });
    await records.save({ ...pullRequest, headCommit: null });
    await expect(actions.merge(pullRequest.id, "merge", USER)).rejects.toMatchObject({
      refresh: true,
    });
    expect(host.merges).toEqual([]);
  });

  it("refuses an ended pull request and one not kept", async () => {
    const pullRequest = await aKeptPullRequest();
    await records.end(pullRequest.id, "closed", new Date());

    await expect(actions.merge(pullRequest.id, "merge", USER)).rejects.toMatchObject({
      reason: `Pull request #${pullRequest.number} is already closed.`,
    });
    await expect(actions.close(pullRequest.id, USER)).rejects.toBeInstanceOf(PullRequestRefused);
    await expect(actions.close(randomUUID(), USER)).rejects.toBeInstanceOf(PullRequestNotFound);
    expect(host.merges).toEqual([]);
    expect(host.closes).toEqual([]);
  });

  it("closes a pull request, ending the row with one event", async () => {
    const pullRequest = await aKeptPullRequest();

    await actions.close(pullRequest.id, USER);

    expect(host.closes).toEqual([pullRequest.number]);
    await expect(records.findById(pullRequest.id)).resolves.toMatchObject({ state: "closed" });
    expect(published).toHaveLength(1);
    expect(published[0]).toBeInstanceOf(PullRequestClosed);
    expect(published).toEqual([
      expect.objectContaining({
        pullRequestId: pullRequest.id,
        by: { kind: "user", ...USER },
      }),
    ]);
  });
});
