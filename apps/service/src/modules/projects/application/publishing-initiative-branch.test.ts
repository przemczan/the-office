import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  commitOnOrigin,
  gitIn,
  type TemporaryRepository,
} from "../adapters/git/temporary-repository.fixtures.js";
import {
  PUBLISHING_TEST,
  PublishingTestbed,
  pullRequestText,
} from "../adapters/git/publishing-testbed.fixtures.js";
import { aProject } from "../domain/project.fixtures.js";
import type { Project } from "../domain/project.js";

let testbed: PublishingTestbed;
let repository: TemporaryRepository;

beforeAll(async () => {
  testbed = await PublishingTestbed.create();
  ({ repository } = testbed);
});

beforeEach(() => {
  testbed.pullRequests.reset();
});

afterAll(async () => {
  await testbed.remove();
});

function publish(project: Project, taskId: string, target: "publishing-mode" | "branch-only") {
  return testbed.publishing.publish(project, taskId, pullRequestText, target);
}

function contains(revision: string, ancestor: string): Promise<boolean> {
  return testbed.git.contains(repository.path, revision, ancestor);
}

describe("Publishing into the Initiative's branch", PUBLISHING_TEST, () => {
  it("merges into the Initiative's branch and pushes it, leaving the remote's base as it was", async () => {
    const project = testbed.mergingProject();
    const branch = testbed.anInitiativeBranch("first-push");
    const task = await testbed.aTaskWithACommit(project, undefined, branch);
    const originMain = testbed.originCommitOf("main");

    const publication = await publish(project, task.taskId, "publishing-mode");

    expect(publication).toEqual({
      kind: "merged",
      branch: task.branch,
      into: { remote: "origin", branch },
      commit: task.commit,
      baseTakenIn: "not-needed",
    });
    expect(testbed.originCommitOf(branch)).toBe(task.commit);
    expect(testbed.localCommitOf(branch)).toBe(task.commit);
    expect(testbed.originCommitOf("main")).toBe(originMain);
    expect(testbed.originCommitOf(task.branch)).toBeUndefined();
  });

  it("takes in the moved Initiative's branch, then the moved base, by merge and never by a rebase", async () => {
    const project = testbed.mergingProject();
    const branch = testbed.anInitiativeBranch("both-moved", { pushed: true });
    const task = await testbed.aTaskWithACommit(project, undefined, branch);
    const initiativeTip = await commitOnOrigin(repository, branch, "from-another-task.txt");
    const baseTip = await commitOnOrigin(repository, "main", "from-main.txt");

    const publication = await publish(project, task.taskId, "publishing-mode");

    if (publication.kind !== "merged")
      throw new Error(`Not merged: ${JSON.stringify(publication)}`);
    expect(publication.baseTakenIn).toBe("by-merge");
    expect(testbed.originCommitOf(branch)).toBe(publication.commit);
    expect(testbed.localCommitOf(branch)).toBe(publication.commit);
    // The Task's own commit is kept as it was, which a rebase would have rewritten.
    await expect(contains(publication.commit, task.commit)).resolves.toBe(true);
    await expect(contains(publication.commit, initiativeTip)).resolves.toBe(true);
    await expect(contains(publication.commit, baseTip)).resolves.toBe(true);
    expect(testbed.originCommitOf("main")).toBe(baseTip);
  });

  it("goes to Resolve when the branch would conflict with the Initiative's branch, naming it", async () => {
    const project = testbed.mergingProject();
    const branch = testbed.anInitiativeBranch("conflicts-with-it", { pushed: true });
    const file = "both-in-the-initiative.txt";
    const task = await testbed.aTaskWithACommit(project, file, branch);
    const initiativeTip = await commitOnOrigin(repository, branch, file);

    const publication = await publish(project, task.taskId, "publishing-mode");

    expect(publication).toEqual({
      kind: "base-moved",
      error: `${task.branch} no longer applies cleanly on ${branch} on origin: it would conflict in\n- ${file}`,
      conflictedFiles: [file],
    });
    expect(testbed.originCommitOf(branch)).toBe(initiativeTip);
    expect(testbed.localCommitOf(task.branch)).toBe(task.commit);
  });

  it("goes to Resolve when the branch would conflict with the base branch, naming it", async () => {
    const project = testbed.mergingProject();
    const branch = testbed.anInitiativeBranch("conflicts-with-main");
    const before = testbed.localCommitOf(branch);
    const file = "both-in-main.txt";
    const task = await testbed.aTaskWithACommit(project, file, branch);
    await commitOnOrigin(repository, "main", file);

    const publication = await publish(project, task.taskId, "publishing-mode");

    expect(publication).toMatchObject({ kind: "base-moved", conflictedFiles: [file] });
    expect(publication.kind === "base-moved" && publication.error).toContain(
      `${task.branch} no longer applies cleanly on main on origin`,
    );
    expect(testbed.localCommitOf(branch)).toBe(before);
    expect(testbed.originCommitOf(branch)).toBeUndefined();
  });

  it("opens no pull request in a Push + PR Project", async () => {
    const project = testbed.pullRequestProject();
    const branch = testbed.anInitiativeBranch("no-pull-request");
    const task = await testbed.aTaskWithACommit(project, undefined, branch);

    const publication = await publish(project, task.taskId, "publishing-mode");

    expect(publication).toMatchObject({ kind: "merged", into: { remote: "origin", branch } });
    expect(testbed.pullRequests.requests).toEqual([]);
    expect(testbed.pullRequests.askedWhy).toEqual([]);
    expect(testbed.originCommitOf(task.branch)).toBeUndefined();
  });

  it("pushes only the Task's branch for a proof of concept, leaving the Initiative's branch as it was", async () => {
    const project = testbed.mergingProject();
    const branch = testbed.anInitiativeBranch("proof-of-concept", { pushed: true });
    const before = testbed.localCommitOf(branch);
    const task = await testbed.aTaskWithACommit(project, undefined, branch);

    const publication = await publish(project, task.taskId, "branch-only");

    expect(publication).toEqual({ kind: "branch-pushed", branch: task.branch, remote: "origin" });
    expect(testbed.originCommitOf(task.branch)).toBe(task.commit);
    expect(testbed.localCommitOf(branch)).toBe(before);
    expect(testbed.originCommitOf(branch)).toBe(before);
  });

  it("moves only the local branch when the base branch tracks no remote", async () => {
    gitIn(repository.path, "branch", "solo", "main");
    const project = aProject({
      path: repository.path,
      baseBranch: "solo",
      publishingMode: "merge",
    });
    const branch = "initiative/no-remote";
    gitIn(repository.path, "branch", branch, "solo");
    const task = await testbed.aTaskWithACommit(project, undefined, branch);

    const publication = await publish(project, task.taskId, "publishing-mode");

    expect(publication).toEqual({
      kind: "merged",
      branch: task.branch,
      into: { remote: "this repository", branch },
      commit: task.commit,
      baseTakenIn: "not-needed",
    });
    expect(testbed.localCommitOf(branch)).toBe(task.commit);
    expect(testbed.originCommitOf(branch)).toBeUndefined();
  });

  it("fails, naming the branch and the Project, when the Initiative's branch is gone", async () => {
    const project = testbed.mergingProject();
    const branch = testbed.anInitiativeBranch("gone");
    const task = await testbed.aTaskWithACommit(project, undefined, branch);
    gitIn(repository.path, "branch", "--quiet", "-D", branch);

    await expect(publish(project, task.taskId, "publishing-mode")).resolves.toEqual({
      kind: "failed",
      error: `The Initiative's branch ${branch} is gone from ${project.name}.`,
    });
  });

  it("fails, naming the branch, when the remote's Initiative's branch has diverged from the local one", async () => {
    const project = testbed.mergingProject();
    const branch = testbed.anInitiativeBranch("diverged", { pushed: true });
    const task = await testbed.aTaskWithACommit(project, undefined, branch);
    const remoteTip = await commitOnOrigin(repository, branch, "remote-only.txt");
    const tree = gitIn(repository.path, "rev-parse", `${branch}^{tree}`);
    const localTip = gitIn(repository.path, "commit-tree", tree, "-p", branch, "-m", "Local only");
    gitIn(repository.path, "update-ref", `refs/heads/${branch}`, localTip);

    const publication = await publish(project, task.taskId, "publishing-mode");

    expect(publication).toMatchObject({ kind: "failed" });
    expect(publication.kind === "failed" && publication.error).toContain(
      `The Initiative's branch ${branch} in ${project.name} has diverged from ${branch} on origin`,
    );
    expect(testbed.localCommitOf(branch)).toBe(localTip);
    expect(testbed.originCommitOf(branch)).toBe(remoteTip);
  });

  it("fails, saying where, when the Initiative's branch is checked out in another worktree", async () => {
    const project = testbed.mergingProject();
    const branch = testbed.anInitiativeBranch("checked-out");
    const before = testbed.localCommitOf(branch);
    const task = await testbed.aTaskWithACommit(project, undefined, branch);
    const elsewhere = join(repository.folder, "users-checkout");
    gitIn(repository.path, "worktree", "add", "--quiet", elsewhere, branch);

    const publication = await publish(project, task.taskId, "publishing-mode");

    expect(publication).toMatchObject({ kind: "failed" });
    expect(publication.kind === "failed" && publication.error).toContain(
      `The Initiative's branch ${branch} is checked out in ${elsewhere}`,
    );
    expect(testbed.localCommitOf(branch)).toBe(before);
    expect(testbed.originCommitOf(branch)).toBeUndefined();
  });

  it("refuses the Task's worktree when its Initiative's branch is gone", async () => {
    const project = testbed.mergingProject();
    testbed.taskBases.initiativeBranches.set("never-made", "initiative/never-made");

    await expect(testbed.worktrees.open(project, "never-made")).rejects.toThrow(
      `The Initiative's branch initiative/never-made is gone from ${project.name}.`,
    );
  });
});
