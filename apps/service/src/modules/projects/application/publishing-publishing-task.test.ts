import { stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { officeIdentityForTests } from "../../../platform/git-identity/office-identity.fixtures.js";
import { serviceVariables } from "../adapters/git/command-line-git.fixtures.js";
import {
  PUBLISHING_TEST,
  PublishingTestbed,
  commitMessage,
} from "../adapters/git/publishing-testbed.fixtures.js";
import {
  commitOnOrigin,
  gitIn,
  type TemporaryRepository,
} from "../adapters/git/temporary-repository.fixtures.js";
import { ShellCommandRunner } from "../adapters/shell/shell-command-runner.js";
import { ProjectNotFound } from "../domain/project-not-found.js";
import type { Project } from "../domain/project.js";
import { BranchUpdates } from "./branch-updates.js";
import { InitiativeBranches } from "./initiative-branches.js";
import { ProjectCommandRunner } from "./project-command-runner.js";
import { ProjectRemotes } from "./project-remotes.js";
import type { ProjectService } from "./project-service.js";
import { Resolving } from "./resolving.js";

// A Publishing Task on real git (spec §2.3, "A Publishing Task's Publish"): its worktree holds the
// Initiative's branch itself, which its Publish takes into the base branch.
let testbed: PublishingTestbed;
let repository: TemporaryRepository;
let updates: BranchUpdates;
let resolving: Resolving;
let branches: InitiativeBranches;
let projectInUse: Project | undefined;

beforeAll(async () => {
  testbed = await PublishingTestbed.create();
  ({ repository } = testbed);
  const commands = new ProjectCommandRunner(new ShellCommandRunner());
  updates = new BranchUpdates(testbed.git, commands, testbed.worktrees);
  resolving = new Resolving(testbed.git, commands, testbed.worktrees, testbed.taskBases);
  const projects = {
    read: (id: string) =>
      projectInUse && id === projectInUse.id
        ? Promise.resolve(projectInUse)
        : Promise.reject(new ProjectNotFound(id)),
  } as unknown as ProjectService;
  branches = new InitiativeBranches(
    projects,
    testbed.git,
    testbed.worktrees,
    commands,
    new ProjectRemotes(testbed.git, officeIdentityForTests()),
    testbed.taskBases,
  );
});

beforeEach(() => {
  testbed.pullRequests.reset();
});

afterAll(async () => {
  await testbed.remove();
});

/** The Publishing Task `taskId` of the Initiative's branch `branch`, with its worktree made. */
async function aPublishingTask(project: Project, taskId: string, branch: string) {
  testbed.taskBases.publishingTasks.set(taskId, branch);
  return testbed.worktrees.open(project, taskId);
}

/** Commits `file` in the worktree at `path`, as a Stage does, and answers the commit. */
async function committed(path: string, file: string): Promise<string> {
  await writeFile(join(path, file), `${file}\n`);
  const commit = await testbed.git.commit(path, `Add ${file}`, serviceVariables);
  if (!commit) throw new Error("Nothing was committed.");
  return commit;
}

function publish(project: Project, taskId: string, target: "publishing-mode" | "branch-only") {
  return testbed.publishing.publish(project, taskId, commitMessage, target);
}

function contains(revision: string, ancestor: string): Promise<boolean> {
  return testbed.git.contains(repository.path, revision, ancestor);
}

function headOf(path: string): string {
  return gitIn(path, "rev-parse", "HEAD");
}

async function changedFiles(project: Project, taskId: string): Promise<readonly string[]> {
  const changes = await testbed.worktrees.changes(project, taskId);
  return changes.files.map((file) => file.path);
}

describe("A Publishing Task's worktree", PUBLISHING_TEST, () => {
  it("holds the Initiative's branch itself, fast-forwarded to its remote's when that is ahead", async () => {
    const project = testbed.mergingProject();
    const branch = testbed.anInitiativeBranch("holds-it", { pushed: true });
    const remoteTip = await commitOnOrigin(repository, branch, "holds-it.txt");

    const worktree = await aPublishingTask(project, "publishing-holds", branch);

    expect(worktree.branch).toBe(branch);
    expect(gitIn(worktree.path, "symbolic-ref", "--short", "HEAD")).toBe(branch);
    expect(headOf(worktree.path)).toBe(remoteTip);
    expect(testbed.localCommitOf(branch)).toBe(remoteTip);
    expect(testbed.localCommitOf("office/publishing-holds")).toBeUndefined();
  });

  it("is refused, saying where, while the branch is checked out elsewhere", async () => {
    const project = testbed.mergingProject();
    const branch = testbed.anInitiativeBranch("held-elsewhere");
    const elsewhere = join(repository.folder, "held-elsewhere");
    gitIn(repository.path, "worktree", "add", "--quiet", elsewhere, branch);
    testbed.taskBases.publishingTasks.set("publishing-refused", branch);

    await expect(testbed.worktrees.open(project, "publishing-refused")).rejects.toThrow(
      `The Initiative's branch ${branch} of ${project.name} is checked out in ${elsewhere}`,
    );
  });

  it("keeps the branch when removed, so a later Publishing Task checks it out", async () => {
    const project = testbed.mergingProject();
    const branch = testbed.anInitiativeBranch("kept");
    const first = await aPublishingTask(project, "publishing-kept-1", branch);
    const commit = await committed(first.path, "kept.txt");

    await testbed.worktrees.remove(project, "publishing-kept-1");

    expect(testbed.localCommitOf(branch)).toBe(commit);
    const second = await aPublishingTask(project, "publishing-kept-2", branch);
    expect(headOf(second.path)).toBe(commit);
  });

  it("shows the full change before Publish, and what Publish shipped after it", async () => {
    const project = testbed.mergingProject();
    const branch = testbed.anInitiativeBranch("changes");
    const worktree = await aPublishingTask(project, "publishing-changes", branch);
    await committed(worktree.path, "changes-1.txt");
    await committed(worktree.path, "changes-2.txt");
    await commitOnOrigin(repository, "main", "changes-on-main.txt");
    gitIn(repository.path, "fetch", "--quiet", "origin");

    expect(await changedFiles(project, "publishing-changes")).toEqual([
      "changes-1.txt",
      "changes-2.txt",
    ]);
    await expect(testbed.worktrees.changesSoFar(project, "publishing-changes")).resolves.toContain(
      "changes-2.txt",
    );

    const publication = await publish(project, "publishing-changes", "publishing-mode");
    expect(publication).toMatchObject({ kind: "merged", baseTakenIn: "by-merge" });
    // The branch moves on past what was published, as a later fix Task's Publish would move it.
    await committed(worktree.path, "after-publish.txt");

    expect(await changedFiles(project, "publishing-changes")).toEqual([
      "changes-1.txt",
      "changes-2.txt",
    ]);
  });
});

describe("A Publishing Task's Publish", PUBLISHING_TEST, () => {
  it("pushes the Initiative's branch and opens a pull request from it in Push + PR", async () => {
    const project = testbed.pullRequestProject();
    const branch = testbed.anInitiativeBranch("pull-request");
    const worktree = await aPublishingTask(project, "publishing-pr", branch);
    const commit = await committed(worktree.path, "pull-request.txt");
    const originMain = testbed.originCommitOf("main");

    const publication = await publish(project, "publishing-pr", "publishing-mode");

    expect(publication).toEqual({
      kind: "pull-request-opened",
      branch,
      url: "https://github.com/notnullsoft/admin/pull/1",
    });
    expect(testbed.pullRequests.requests).toEqual([
      expect.objectContaining({ baseBranch: "main", branch, title: commitMessage.subject }),
    ]);
    expect(testbed.originCommitOf(branch)).toBe(commit);
    expect(testbed.originCommitOf("main")).toBe(originMain);
    expect(gitIn(repository.path, "rev-parse", "refs/office/published/publishing-pr")).toBe(commit);
  });

  it("merges the moved base by one merge commit, never a rebase, and fast-forwards the base on the remote, carrying the Initiative's commits unchanged", async () => {
    const project = testbed.mergingProject();
    const branch = testbed.anInitiativeBranch("merge", { pushed: true });
    const worktree = await aPublishingTask(project, "publishing-merge", branch);
    const own = await committed(worktree.path, "merge.txt");
    const baseTip = await commitOnOrigin(repository, "main", "merge-on-main.txt");
    const localMain = testbed.localCommitOf("main");

    const publication = await publish(project, "publishing-merge", "publishing-mode");

    if (publication.kind !== "merged") throw new Error(JSON.stringify(publication));
    expect(publication).toMatchObject({
      branch,
      into: { remote: "origin", branch: "main" },
      baseTakenIn: "by-merge",
    });
    const { commit } = publication;
    expect(gitIn(repository.path, "rev-parse", `${commit}^1`)).toBe(own);
    expect(gitIn(repository.path, "rev-parse", `${commit}^2`)).toBe(baseTip);
    await expect(contains(commit, own)).resolves.toBe(true);
    expect(publication.subject).toBeUndefined();
    expect(publication.head).toBe(commit);
    expect(headOf(worktree.path)).toBe(commit);
    expect(testbed.originCommitOf(branch)).toBe(commit);
    expect(testbed.originCommitOf("main")).toBe(commit);
    // The user's checkout has main, so it stays as it was.
    expect(testbed.localCommitOf("main")).toBe(localMain);
  });

  it("answers nothing to publish once the base holds the branch", async () => {
    const project = testbed.mergingProject();
    const branch = testbed.anInitiativeBranch("nothing");
    await aPublishingTask(project, "publishing-nothing", branch);

    await expect(publish(project, "publishing-nothing", "publishing-mode")).resolves.toEqual({
      kind: "nothing-to-publish",
      branch,
      base: { remote: "origin", branch: "main" },
    });
  });

  it("pushes only the Initiative's branch for a proof of concept", async () => {
    const project = testbed.mergingProject();
    const branch = testbed.anInitiativeBranch("branch-only");
    const worktree = await aPublishingTask(project, "publishing-branch-only", branch);
    const commit = await committed(worktree.path, "branch-only.txt");
    const originMain = testbed.originCommitOf("main");

    await expect(publish(project, "publishing-branch-only", "branch-only")).resolves.toEqual({
      kind: "branch-pushed",
      branch,
      remote: "origin",
    });
    expect(testbed.originCommitOf(branch)).toBe(commit);
    expect(testbed.originCommitOf("main")).toBe(originMain);
  });

  it.each(["merge", "push-and-pull-request"] as const)(
    "goes to Resolve on a conflict with the base in %s, which takes in the base only",
    async (mode) => {
      const project = testbed.aProjectPublishingBy(mode);
      const branch = testbed.anInitiativeBranch(`conflict-${mode}`, { pushed: true });
      const taskId = `conflict-${mode}`;
      const worktree = await aPublishingTask(project, taskId, branch);
      const file = `conflict-${mode}.txt`;
      const own = await committed(worktree.path, file);
      await commitOnOrigin(repository, "main", file);

      const publication = await publish(project, taskId, "publishing-mode");

      expect(publication).toMatchObject({ kind: "base-moved", conflictedFiles: [file] });
      expect(headOf(worktree.path)).toBe(own);
      expect(testbed.pullRequests.requests).toEqual([]);

      await expect(resolving.start(project, taskId)).resolves.toEqual({
        kind: "conflicted",
        base: { remote: "origin", branch: "main" },
        conflictedFiles: [file],
      });
      await resolving.abandon(project, taskId);
    },
  );

  it("fails with no remote to push to when the base branch tracks none", async () => {
    gitIn(repository.path, "branch", "solo-publishing", "main");
    const project = { ...testbed.mergingProject(), baseBranch: "solo-publishing" };
    const branch = "initiative/solo-publishing";
    gitIn(repository.path, "branch", branch, "solo-publishing");
    const worktree = await aPublishingTask(project, "publishing-solo", branch);
    await committed(worktree.path, "solo.txt");

    const publication = await publish(project, "publishing-solo", "publishing-mode");

    expect(publication).toMatchObject({ kind: "failed" });
    expect(publication.kind === "failed" && publication.error).toContain(
      "solo-publishing tracks no remote branch",
    );
  });
});

describe("Pushing a Publishing Task's branch after a Stage", PUBLISHING_TEST, () => {
  it("pushes the Initiative's branch, and is not needed for another Task", async () => {
    const project = testbed.mergingProject();
    const branch = testbed.anInitiativeBranch("after-stage");
    const worktree = await aPublishingTask(project, "publishing-after-stage", branch);
    const commit = await committed(worktree.path, "after-stage.txt");

    await expect(
      testbed.publishing.pushPublishingBranch(project, "publishing-after-stage"),
    ).resolves.toEqual({ kind: "pushed" });
    expect(testbed.originCommitOf(branch)).toBe(commit);

    const task = await testbed.aTaskWithACommit(project);
    await expect(testbed.publishing.pushPublishingBranch(project, task.taskId)).resolves.toEqual({
      kind: "not-needed",
    });
  });

  it("answers why when the remote refuses the push", async () => {
    const project = testbed.mergingProject();
    const branch = testbed.anInitiativeBranch("refused-push", { pushed: true });
    const worktree = await aPublishingTask(project, "publishing-refused-push", branch);
    await commitOnOrigin(repository, branch, "refused-push-remote.txt");
    await committed(worktree.path, "refused-push-local.txt");

    const push = await testbed.publishing.pushPublishingBranch(project, "publishing-refused-push");

    expect(push).toMatchObject({ kind: "failed" });
    expect(push.kind === "failed" && push.reason).toContain(`refused the push of ${branch}`);
  });
});

describe("Whether an Initiative's branch holds unpublished work", PUBLISHING_TEST, () => {
  it("answers against the fetched base, and against a Publishing Task's published tip", async () => {
    const project = testbed.mergingProject();
    projectInUse = project;
    const branch = testbed.anInitiativeBranch("unpublished");
    await expect(branches.holdsUnpublished(project.id, branch)).resolves.toBe(false);

    const worktree = await aPublishingTask(project, "publishing-unpublished", branch);
    await committed(worktree.path, "unpublished.txt");
    await expect(branches.holdsUnpublished(project.id, branch)).resolves.toBe(true);
    await expect(
      branches.holdsUnpublished(project.id, branch, "publishing-unpublished"),
    ).resolves.toBe(true);

    await publish(project, "publishing-unpublished", "branch-only");
    await expect(
      branches.holdsUnpublished(project.id, branch, "publishing-unpublished"),
    ).resolves.toBe(false);

    await committed(worktree.path, "unpublished-later.txt");
    await expect(
      branches.holdsUnpublished(project.id, branch, "publishing-unpublished"),
    ).resolves.toBe(true);
  });

  it("answers true for a branch that is gone", async () => {
    const project = testbed.mergingProject();
    projectInUse = project;

    await expect(branches.holdsUnpublished(project.id, "initiative/never-there")).resolves.toBe(
      true,
    );
  });
});

describe("A fix Task's Publish into a branch a Publishing Task holds", PUBLISHING_TEST, () => {
  it("fast-forwards the clean Publishing Task's worktree and says so", async () => {
    const project = testbed.mergingProject();
    const branch = testbed.anInitiativeBranch("fix-clean", { pushed: true });
    const publishing = await aPublishingTask(project, "publishing-fix-clean", branch);
    const before = headOf(publishing.path);
    const fix = await testbed.aTaskWithACommit(project, "fix-clean.txt", branch);

    const publication = await publish(project, fix.taskId, "publishing-mode");

    const landed = testbed.originCommitOf(branch) ?? "";
    expect(publication).toEqual({
      kind: "merged",
      branch: fix.branch,
      into: { remote: "origin", branch },
      commit: landed,
      subject: commitMessage.subject,
      head: fix.commit,
      baseTakenIn: "not-needed",
      basesTakenIn: [],
      movedWorktreeOf: "publishing-fix-clean",
    });
    expect(gitIn(repository.path, "rev-list", "--parents", "--max-count=1", landed)).toBe(
      `${landed} ${before}`,
    );
    expect(headOf(publishing.path)).toBe(landed);
    await expect(stat(join(publishing.path, "fix-clean.txt"))).resolves.toBeDefined();
    expect(gitIn(repository.path, "rev-parse", "refs/office/moved-to/publishing-fix-clean")).toBe(
      landed,
    );
    await expect(updates.movedAlongBase(project, "publishing-fix-clean", before)).resolves.toBe(
      true,
    );
  });

  it("fails, saying so, while the Publishing Task's worktree has changes not committed", async () => {
    const project = testbed.mergingProject();
    const branch = testbed.anInitiativeBranch("fix-dirty", { pushed: true });
    const publishing = await aPublishingTask(project, "publishing-fix-dirty", branch);
    const before = headOf(publishing.path);
    const fix = await testbed.aTaskWithACommit(project, "fix-dirty.txt", branch);
    await writeFile(join(publishing.path, "being-written.txt"), "half done\n");

    const publication = await publish(project, fix.taskId, "publishing-mode");

    expect(publication).toMatchObject({ kind: "failed" });
    expect(publication.kind === "failed" && publication.error).toContain(
      "which has changes not committed",
    );
    expect(headOf(publishing.path)).toBe(before);
    expect(testbed.originCommitOf(branch)).toBe(before);
  });
});
