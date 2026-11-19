import { realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { serviceVariables } from "../adapters/git/command-line-git.fixtures.js";
import { PUBLISHING_TEST, PublishingTestbed } from "../adapters/git/publishing-testbed.fixtures.js";
import { commitOnOrigin, gitIn } from "../adapters/git/temporary-repository.fixtures.js";
import type { Project } from "../domain/project.js";

// A Conflict resolution Task's worktree on real git, beyond its main rule: what it does with the
// pull request's branch gone, diverged or checked out elsewhere.
let testbed: PublishingTestbed;

beforeAll(async () => {
  testbed = await PublishingTestbed.create();
});

afterAll(async () => {
  await testbed.remove();
});

/**
 * A Task whose branch is pushed, as its Push + PR left it, its worktree removed unless `removed`
 * is false, and a Conflict resolution Task `resolves-<name>` of its pull request.
 */
async function aPullRequestToResolve(project: Project, name: string, { removed = true } = {}) {
  const original = await testbed.aTaskWithACommit(project);
  gitIn(testbed.repository.path, "push", "--quiet", "origin", original.branch);
  if (removed) await testbed.worktrees.remove(project, original.taskId);
  const taskId = `resolves-${name}`;
  testbed.taskBases.pullRequestsResolved.set(taskId, original.taskId);
  return { original, taskId };
}

describe("A Conflict resolution Task's worktree", PUBLISHING_TEST, () => {
  it("makes the pull request's branch again from the remote's copy when it is gone from here", async () => {
    const project = testbed.pullRequestProject();
    const { original, taskId } = await aPullRequestToResolve(project, "gone-here");
    const remoteTip = await commitOnOrigin(testbed.repository, original.branch, "gone-here.txt");
    gitIn(testbed.repository.path, "branch", "--quiet", "-D", original.branch);

    const worktree = await testbed.worktrees.open(project, taskId);

    expect(gitIn(worktree.path, "symbolic-ref", "--short", "HEAD")).toBe(original.branch);
    expect(gitIn(worktree.path, "rev-parse", "HEAD")).toBe(remoteTip);
    expect(testbed.localCommitOf(original.branch)).toBe(remoteTip);
  });

  it("is refused when the pull request's branch is gone from here and from the remote", async () => {
    const project = testbed.pullRequestProject();
    const { original, taskId } = await aPullRequestToResolve(project, "gone-everywhere");
    gitIn(testbed.repository.path, "branch", "--quiet", "-D", original.branch);
    gitIn(testbed.repository.originPath, "branch", "--quiet", "-D", original.branch);

    await expect(testbed.worktrees.open(project, taskId)).rejects.toThrow(
      `The pull request's branch ${original.branch} is gone from ${project.name} and from its remote.`,
    );
  });

  it("is refused when the pull request's branch has diverged from its remote's", async () => {
    const project = testbed.pullRequestProject();
    const { original, taskId } = await aPullRequestToResolve(project, "diverged");
    await commitOnOrigin(testbed.repository, original.branch, "diverged-there.txt");
    const repository = testbed.repository.path;
    const here = gitIn(
      repository,
      "commit-tree",
      `${original.branch}^{tree}`,
      "-p",
      original.branch,
      "-m",
      "Diverged here",
    );
    gitIn(repository, "update-ref", `refs/heads/${original.branch}`, here);

    await expect(testbed.worktrees.open(project, taskId)).rejects.toThrow(
      `The pull request's branch ${original.branch} in ${project.name} has diverged from ${original.branch} on origin`,
    );
    expect(testbed.localCommitOf(original.branch)).toBe(here);
  });

  it("is refused, naming where, while the original Task's worktree has the branch, which the check before says too", async () => {
    const project = testbed.pullRequestProject();
    const { original, taskId } = await aPullRequestToResolve(project, "held", { removed: false });
    const held = await realpath(testbed.worktrees.pathOf(project, original.taskId));

    await expect(testbed.worktrees.checkoutOf(project, original.taskId)).resolves.toEqual({
      branch: original.branch,
      checkedOutIn: held,
      inTasksOwnWorktree: true,
    });
    await expect(testbed.worktrees.open(project, taskId)).rejects.toThrow(
      `The branch ${original.branch} of ${project.name} is checked out in ${held}, so the Conflict resolution Task's worktree can't hold it.`,
    );

    await testbed.worktrees.remove(project, original.taskId);
    await expect(testbed.worktrees.checkoutOf(project, original.taskId)).resolves.toEqual({
      branch: original.branch,
      checkedOutIn: undefined,
      inTasksOwnWorktree: false,
    });
  });

  it("holds an Initiative's branch when the pull request is a Publishing Task's", async () => {
    const project = testbed.pullRequestProject();
    const branch = testbed.anInitiativeBranch("resolved", { pushed: true });
    testbed.taskBases.publishingTasks.set("publishing-resolved", branch);
    testbed.taskBases.pullRequestsResolved.set("resolves-initiative", "publishing-resolved");

    const worktree = await testbed.worktrees.open(project, "resolves-initiative");
    await writeFile(join(worktree.path, "resolved.txt"), "resolved\n");
    const commit = await testbed.git.commit(worktree.path, "Resolve", serviceVariables);

    expect(worktree.branch).toBe(branch);
    expect(testbed.localCommitOf(branch)).toBe(commit);
  });
});
