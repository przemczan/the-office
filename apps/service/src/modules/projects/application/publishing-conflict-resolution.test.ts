import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { serviceVariables } from "../adapters/git/command-line-git.fixtures.js";
import {
  PUBLISHING_TEST,
  PublishingTestbed,
  commitMessage,
} from "../adapters/git/publishing-testbed.fixtures.js";
import { commitOnOrigin, gitIn } from "../adapters/git/temporary-repository.fixtures.js";
import type { Project } from "../domain/project.js";
import { PullRequestBranchPushed } from "../domain/pull-request-events.js";

// A Conflict resolution Task on real git (spec §2.3, "Resolve conflicts"): its worktree holds the
// branch of the pull request it resolves, and its Publish pushes that branch back, without force.
let testbed: PublishingTestbed;

beforeAll(async () => {
  testbed = await PublishingTestbed.create();
});

beforeEach(() => {
  testbed.pullRequests.reset();
});

afterAll(async () => {
  await testbed.remove();
});

/**
 * A Task whose branch is pushed, as its Push + PR left it, its worktree removed, and a Conflict
 * resolution Task `resolves-<name>` of its pull request.
 */
async function aPullRequestToResolve(project: Project, name: string) {
  const original = await testbed.aTaskWithACommit(project);
  gitIn(testbed.repository.path, "push", "--quiet", "origin", original.branch);
  await testbed.worktrees.remove(project, original.taskId);
  const taskId = `resolves-${name}`;
  testbed.taskBases.pullRequestsResolved.set(taskId, original.taskId);
  return { original, taskId };
}

/** Commits `file` in the worktree at `path`, as a Stage does, and answers the commit. */
async function committed(path: string, file: string): Promise<string> {
  await writeFile(join(path, file), `${file}\n`);
  const commit = await testbed.git.commit(path, `Add ${file}`, serviceVariables);
  if (!commit) throw new Error("Nothing was committed.");
  return commit;
}

describe("A Conflict resolution Task", PUBLISHING_TEST, () => {
  it("holds the pull request's branch, brought to its remote's, and pushes it back to the same pull request", async () => {
    const project = testbed.pullRequestProject();
    const { original, taskId } = await aPullRequestToResolve(project, "pushes");
    const remoteTip = await commitOnOrigin(testbed.repository, original.branch, "from-host.txt");

    const worktree = await testbed.worktrees.open(project, taskId);

    expect(worktree.branch).toBe(original.branch);
    expect(gitIn(worktree.path, "symbolic-ref", "--short", "HEAD")).toBe(original.branch);
    expect(gitIn(worktree.path, "rev-parse", "HEAD")).toBe(remoteTip);
    expect(testbed.localCommitOf(`office/${taskId}`)).toBeUndefined();

    const resolved = await committed(worktree.path, "resolved.txt");
    // Whatever the target and the publishing mode: the branch alone, no new pull request.
    const publication = await testbed.publishing.publish(
      project,
      taskId,
      commitMessage,
      "publishing-mode",
    );

    expect(publication).toEqual({
      kind: "branch-pushed",
      branch: original.branch,
      remote: "origin",
    });
    expect(testbed.originCommitOf(original.branch)).toBe(resolved);
    expect(testbed.pullRequests.requests).toEqual([]);
    expect(
      testbed.published.filter(
        (event) => event instanceof PullRequestBranchPushed && event.taskId === taskId,
      ),
    ).toEqual([
      expect.objectContaining({
        projectId: project.id,
        pullRequestTaskId: original.taskId,
        branch: original.branch,
      }),
    ]);
  });

  it("leaves the pull request's branch at its last commit when its worktree is removed", async () => {
    const project = testbed.pullRequestProject();
    const { original, taskId } = await aPullRequestToResolve(project, "removed");
    const worktree = await testbed.worktrees.open(project, taskId);
    const commit = await committed(worktree.path, "dropped.txt");

    await testbed.worktrees.remove(project, taskId);

    expect(testbed.localCommitOf(original.branch)).toBe(commit);
  });
});
