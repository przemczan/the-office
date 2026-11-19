import { describe, expect, it } from "vitest";
import { TaskPullRequestEnded, TaskPullRequestReopened } from "./task-events.js";
import {
  clearPullRequestEnd,
  pullRequestEndWords,
  recordPullRequestEnd,
  type PullRequestEnd,
} from "./task-pull-request.js";
import { ANN_LEE, aTask } from "./work.fixtures.js";

const MERGED: PullRequestEnd = {
  outcome: "merged",
  number: 12,
  url: "https://github.com/acme/admin-panel/pull/12",
  at: new Date("2026-11-19T10:00:00.000Z"),
  method: "squash",
  by: ANN_LEE,
};

describe("recordPullRequestEnd", () => {
  it("marks the Task with how its pull request ended, leaving its state as it is", () => {
    const task = aTask({ state: "in-progress" });

    const change = recordPullRequestEnd(task, MERGED);

    expect(change?.task).toEqual({ ...task, pullRequestEnd: MERGED });
    expect(change?.event).toBeInstanceOf(TaskPullRequestEnded);
    expect(change?.event).toMatchObject({ taskId: task.id, outcome: "merged", number: 12 });
    expect(change?.stateChange).toBeUndefined();
  });

  it("records it on an archived Task too", () => {
    const task = aTask({ state: "done", archivedAt: new Date("2026-11-18T10:00:00.000Z") });

    expect(recordPullRequestEnd(task, MERGED)?.task).toMatchObject({
      state: "done",
      archivedAt: task.archivedAt,
      pullRequestEnd: MERGED,
    });
  });

  it("changes nothing when the same end of the same pull request is recorded again", () => {
    const task = aTask({ pullRequestEnd: MERGED });

    expect(recordPullRequestEnd(task, { ...MERGED, at: new Date() })).toBeUndefined();
  });

  it("records another outcome, or another pull request's end, over the one it had", () => {
    const task = aTask({ pullRequestEnd: MERGED });
    const closed: PullRequestEnd = { ...MERGED, outcome: "closed", method: undefined };
    const another: PullRequestEnd = { ...MERGED, number: 13 };

    expect(recordPullRequestEnd(task, closed)?.task.pullRequestEnd).toEqual(closed);
    expect(recordPullRequestEnd(task, another)?.task.pullRequestEnd).toEqual(another);
  });
});

describe("clearPullRequestEnd", () => {
  it("clears the end when its pull request is open again, leaving the state as it is", () => {
    const task = aTask({ state: "done", pullRequestEnd: MERGED });
    const at = new Date("2026-11-19T11:00:00.000Z");

    const change = clearPullRequestEnd(task, 12, at);

    expect(change?.task).toEqual({ ...task, pullRequestEnd: undefined });
    expect(change?.event).toBeInstanceOf(TaskPullRequestReopened);
    expect(change?.event).toMatchObject({ taskId: task.id, number: 12, occurredAt: at });
  });

  it("works on an archived Task too", () => {
    const task = aTask({ state: "done", archivedAt: new Date(), pullRequestEnd: MERGED });

    expect(clearPullRequestEnd(task, 12, new Date())?.task.pullRequestEnd).toBeUndefined();
  });

  it("changes nothing with no end recorded, or one of another pull request", () => {
    expect(clearPullRequestEnd(aTask(), 12, new Date())).toBeUndefined();
    expect(clearPullRequestEnd(aTask({ pullRequestEnd: MERGED }), 13, new Date())).toBeUndefined();
  });

  it("lets the same end be recorded again after a reopen", () => {
    const reopened = clearPullRequestEnd(aTask({ pullRequestEnd: MERGED }), 12, new Date());

    expect(recordPullRequestEnd(reopened!.task, MERGED)?.task.pullRequestEnd).toEqual(MERGED);
  });
});

describe("pullRequestEndWords", () => {
  it("names how and by whom it was merged, or that it ended on the code host", () => {
    expect(pullRequestEndWords(MERGED)).toBe(
      "Pull request #12 (https://github.com/acme/admin-panel/pull/12) merged (squash) by the user Ann Lee on 2026-11-19T10:00:00.000Z",
    );
    expect(
      pullRequestEndWords({
        ...MERGED,
        outcome: "closed",
        method: undefined,
        by: { kind: "code-host", name: "GitHub" },
      }),
    ).toBe(
      "Pull request #12 (https://github.com/acme/admin-panel/pull/12) closed on GitHub on 2026-11-19T10:00:00.000Z",
    );
  });
});
