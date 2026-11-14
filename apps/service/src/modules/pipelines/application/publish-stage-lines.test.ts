import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
  aDoneResult,
  anAgentSession,
  answerLastDecision,
  runsOf,
  startPipelinesApplication,
  walkStages,
  type PipelinesApplication,
} from "../pipelines-application.fixtures.js";
import { aCommandRun, aTaskRecord } from "../ports/pipelines-ports.fixtures.js";
import { implement, publish, PULL_REQUEST } from "../publish-stage.fixtures.js";

const BEFORE = "npx changeset version";
const AFTER = "gh workflow run release.yml";

let pipelines: PipelinesApplication;

afterEach(async () => {
  await pipelines.app.close();
});

/** Starts with both publishing lines set and an Agent Stage for each Implement given. */
async function withLines(implementRuns = 1): Promise<PipelinesApplication> {
  const started = await startPipelinesApplication(
    Array.from({ length: implementRuns }, () => anAgentSession(aDoneResult())),
  );
  started.commands.publishingLineSet.beforePublishingCommand = BEFORE;
  started.commands.publishingLineSet.afterPublishingCommand = AFTER;
  return started;
}

describe("A Publish Stage's before publishing line", () => {
  it("runs before anything leaves, and what it changed is committed and published, HEAD expected there", async () => {
    pipelines = await withLines();
    const calls: string[] = [];
    pipelines.commands.onPublishingLine = (_taskId, line) => calls.push(line);
    pipelines.git.observe = (call) => {
      if (call === "commit") calls.push(`commit after ${pipelines.publishing.published.length}`);
    };

    const taskId = await walkStages(pipelines, [implement, publish]);

    const [implemented, published] = await runsOf(pipelines, taskId);
    const lineCommit = pipelines.git.commits.at(-1);
    expect(calls).toEqual([
      "commit after 0",
      "beforePublishingCommand",
      "commit after 0",
      "afterPublishingCommand",
    ]);
    expect(lineCommit?.message).toContain(`\`${BEFORE}\` passed.`);
    expect(lineCommit?.commit).not.toBe(implemented?.headCommit);
    expect(published?.headCommit).toBe(lineCommit?.commit);
    expect(published?.outcome?.status).toBe("done");
    expect(published?.commandRuns.map(({ purpose }) => purpose)).toEqual([
      "before-publishing",
      "after-publishing",
    ]);
    expect(pipelines.publishing.published).toHaveLength(1);
  });

  it("fails as a Script Stage's command does, publishing nothing, and runs again with Publish", async () => {
    pipelines = await withLines(2);
    pipelines.commands.publishingLineRuns.push(aCommandRun(BEFORE, "failed", "No changesets."));

    const taskId = await walkStages(pipelines, [implement, publish]);

    const runs = await runsOf(pipelines, taskId);
    expect(runs.map(({ stageKey, outcome }) => [stageKey, outcome?.status])).toEqual([
      ["implement", "done"],
      ["publish", "failed"],
      ["implement", "done"],
      ["publish", "done"],
    ]);
    const failure = runs[1]?.outcome;
    expect(failure?.status === "failed" && failure.error).toMatch(
      /^The before publishing line failed, so nothing was published: `npx changeset version` failed with exit code 1\./,
    );
    expect(runs[2]?.carriedFailure?.stageKey).toBe("publish");
    const failedLineCommit = pipelines.git.commits.find(({ message }) =>
      message.includes(`\`${BEFORE}\` failed`),
    );
    expect(failedLineCommit).toBeDefined();
    expect(runs[1]?.headCommit).toBe(failedLineCommit?.commit);
    expect(pipelines.publishing.published).toHaveLength(1);
    expect(pipelines.commands.publishingLinesRan.map(({ line }) => line)).toEqual([
      "beforePublishingCommand",
      "beforePublishingCommand",
      "afterPublishingCommand",
    ]);
  });
});

describe("A Publish Stage's publishing lines", () => {
  it("don't run for the branch-only push", async () => {
    pipelines = await withLines();
    pipelines.publishing.publications.push({
      kind: "branch-pushed",
      branch: "office/task",
      remote: "origin",
    });

    await walkStages(pipelines, [implement, { ...publish, publishTarget: "branch-only" }]);

    expect(pipelines.commands.publishingLinesRan).toEqual([]);
  });

  it("don't run for a Task publishing into its Initiative's branch", async () => {
    pipelines = await withLines();
    const taskId = randomUUID();
    pipelines.records.put(taskId, aTaskRecord({ initiativeBranch: "initiative/usage-exports" }));
    pipelines.publishing.publications.push({
      kind: "merged",
      branch: "office/task",
      into: { remote: "origin", branch: "initiative/usage-exports" },
      commit: "f".repeat(40),
      baseTakenIn: "not-needed",
    });

    await walkStages(pipelines, [implement, publish], taskId);

    expect(pipelines.commands.publishingLinesRan).toEqual([]);
    expect((await runsOf(pipelines, taskId)).at(-1)?.outcome?.status).toBe("done");
  });

  it("run for a Publishing Task", async () => {
    pipelines = await withLines();
    const taskId = randomUUID();
    pipelines.records.put(
      taskId,
      aTaskRecord({ initiativeBranch: "initiative/usage-exports", publishingTask: true }),
    );

    await walkStages(pipelines, [implement, publish], taskId);

    expect(pipelines.commands.publishingLinesRan.map(({ line }) => line)).toEqual([
      "beforePublishingCommand",
      "afterPublishingCommand",
    ]);
  });

  it("run no after line when there was nothing to publish, and the outcome says so", async () => {
    pipelines = await withLines();
    pipelines.publishing.publications.push({
      kind: "nothing-to-publish",
      branch: "office/task",
      base: { remote: "origin", branch: "main" },
    });

    const taskId = await walkStages(pipelines, [implement, publish]);

    expect(pipelines.commands.publishingLinesRan.map(({ line }) => line)).toEqual([
      "beforePublishingCommand",
    ]);
    const outcome = (await runsOf(pipelines, taskId)).at(-1)?.outcome;
    expect(outcome?.status === "done" && outcome.summary).toBe(
      "office/task adds nothing to main on origin, so there was nothing to publish. The after publishing line didn't run, as nothing shipped.",
    );
  });
});

describe("A Publish Stage's after publishing line", () => {
  it("gets what shipped by Push + PR: the branch, its HEAD and the pull request", async () => {
    pipelines = await withLines();

    const taskId = await walkStages(pipelines, [implement, publish]);

    const published = (await runsOf(pipelines, taskId)).at(-1);
    expect(pipelines.commands.publishingLinesRan.at(-1)?.variables).toEqual({
      OFFICE_PUBLISHED_BRANCH: "office/task",
      OFFICE_PUBLISHED_COMMIT: published?.headCommit,
      OFFICE_PULL_REQUEST_URL: PULL_REQUEST,
      OFFICE_PUBLISHING_MODE: "push-and-pull-request",
    });
    expect(published?.published).toEqual({
      kind: "pull-request-opened",
      branch: "office/task",
      commit: published?.headCommit,
      pullRequestUrl: PULL_REQUEST,
    });
    expect(published?.outcome).toEqual({
      status: "done",
      summary: `Pushed office/task and opened the pull request ${PULL_REQUEST}\n\nThe after publishing line passed.`,
      pullRequestUrl: PULL_REQUEST,
    });
    expect(pipelines.git.removedWorktrees).toEqual([taskId]);
  });

  it("gets the merged commit after a merge, and no pull request", async () => {
    pipelines = await withLines();
    const merged = "f".repeat(40);
    pipelines.publishing.publications.push({
      kind: "merged",
      branch: "office/task",
      into: { remote: "origin", branch: "main" },
      commit: merged,
      baseTakenIn: "by-rebase",
    });

    await walkStages(pipelines, [implement, publish]);

    expect(pipelines.commands.publishingLinesRan.at(-1)?.variables).toEqual({
      OFFICE_PUBLISHED_BRANCH: "office/task",
      OFFICE_PUBLISHED_COMMIT: merged,
      OFFICE_PUBLISHING_MODE: "merge",
    });
  });

  it("failing, keeps the worktree and asks whoever holds Asked first straight away, never going back", async () => {
    pipelines = await withLines();
    pipelines.people.holders.set("asked-first-when-out-of-tries", "architect");
    pipelines.commands.publishingLineRuns.push(
      aCommandRun(BEFORE, "passed"),
      aCommandRun(AFTER, "failed", "HTTP 401"),
    );

    const taskId = await walkStages(pipelines, [implement, publish]);

    const runs = await runsOf(pipelines, taskId);
    expect(runs.map(({ stageKey }) => stageKey)).toEqual(["implement", "publish"]);
    expect(runs[1]?.outcome).toMatchObject({
      status: "failed",
      afterPublishingFailed: { kind: "pull-request-opened", pullRequestUrl: PULL_REQUEST },
    });
    const outcome = runs[1]?.outcome;
    expect(outcome?.status === "failed" && outcome.error).toMatch(
      /^Published; after publishing failed: `gh workflow run release\.yml` failed with exit code 1\./,
    );
    expect(pipelines.git.removedWorktrees).toEqual([]);
    const asked = pipelines.decisions.on(taskId).at(-1);
    expect(asked?.putTo).toBe("architect");
    expect(asked?.draft.options).toEqual(["Retry the after publishing line", "Continue"]);
  });

  it("runs again alone on Retry, never publishing again", async () => {
    pipelines = await withLines();
    pipelines.commands.publishingLineRuns.push(
      aCommandRun(BEFORE, "passed"),
      aCommandRun(AFTER, "failed", "HTTP 401"),
    );
    const taskId = await walkStages(pipelines, [implement, publish]);

    await answerLastDecision(pipelines, taskId, { kind: "option", option: 0 });

    const runs = await runsOf(pipelines, taskId);
    expect(runs.map(({ stageKey, outcome }) => [stageKey, outcome?.status])).toEqual([
      ["implement", "done"],
      ["publish", "failed"],
      ["publish", "done"],
    ]);
    expect(pipelines.publishing.published).toHaveLength(1);
    expect(pipelines.commands.publishingLinesRan.map(({ line }) => line)).toEqual([
      "beforePublishingCommand",
      "afterPublishingCommand",
      "afterPublishingCommand",
    ]);
    expect(runs[2]?.outcome).toEqual({
      status: "done",
      summary: `Pushed office/task and opened the pull request ${PULL_REQUEST}\n\nThe after publishing line passed.`,
      pullRequestUrl: PULL_REQUEST,
    });
    expect(pipelines.git.removedWorktrees).toEqual([taskId]);
    expect(pipelines.tasks.changes.at(-1)).toEqual({ taskId, state: "done" });
  });

  it("goes on with the failure noted on Continue, removing the worktree", async () => {
    pipelines = await withLines();
    pipelines.commands.publishingLineRuns.push(
      aCommandRun(BEFORE, "passed"),
      aCommandRun(AFTER, "failed", "HTTP 401"),
    );
    const taskId = await walkStages(pipelines, [implement, publish]);

    await answerLastDecision(pipelines, taskId, { kind: "option", option: 1 });

    const runs = await runsOf(pipelines, taskId);
    expect(runs.map(({ stageKey, outcome }) => [stageKey, outcome?.status])).toEqual([
      ["implement", "done"],
      ["publish", "failed"],
      ["publish", "done"],
    ]);
    const outcome = runs[2]?.outcome;
    expect(outcome?.status === "done" && outcome.summary).toMatch(
      /^Published; after publishing failed: [\s\S]*\n\nThe Task went on with this failure noted\.$/,
    );
    expect(outcome?.status === "done" && outcome.pullRequestUrl).toBe(PULL_REQUEST);
    expect(pipelines.publishing.published).toHaveLength(1);
    expect(pipelines.commands.publishingLinesRan).toHaveLength(2);
    expect(pipelines.git.removedWorktrees).toEqual([taskId]);
    expect(pipelines.tasks.changes.at(-1)).toEqual({ taskId, state: "done" });
  });
});
