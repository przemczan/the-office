import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { OfficeDataDirectory } from "../../../platform/office-data/office-data-directory.js";
import { CommandLineGit } from "../adapters/git/command-line-git.js";
import { RepositoryLocks } from "../adapters/git/repository-locks.js";
import {
  commitOnOrigin,
  createTemporaryRepository,
  gitIn,
  type TemporaryRepository,
} from "../adapters/git/temporary-repository.fixtures.js";
import { ShellCommandRunner } from "../adapters/shell/shell-command-runner.js";
import type { Project, PublishingMode } from "../domain/project.js";
import { aProject } from "../domain/project.fixtures.js";
import {
  PullRequestRefused,
  PullRequests,
  type PullRequest,
  type PullRequestRequest,
} from "../ports/pull-requests.js";
import { ProjectCommandRunner } from "./project-command-runner.js";
import { Publishing } from "./publishing.js";
import { Worktrees } from "./worktrees.js";

/** GitHub in memory: each request opens a pull request, unless a test refuses or holds it. */
class PullRequestsForTests extends PullRequests {
  readonly requests: PullRequestRequest[] = [];
  refusal: string | undefined = undefined;
  /** Set while the next request waits until the test lets it go on. */
  held: Promise<void> | undefined = undefined;

  async open(request: PullRequestRequest): Promise<PullRequest> {
    this.requests.push(request);
    await this.held;
    if (this.refusal) throw new PullRequestRefused(this.refusal);
    return { url: `https://github.com/notnullsoft/admin/pull/${this.requests.length}` };
  }
}

/** Several real git commands a test, slower while every test file runs at once. */
const GIT_TIMEOUT = { timeout: 30_000 };

// Real git on a temporary repository whose main tracks its origin's, which is a bare repository.
let repository: TemporaryRepository;
let git: CommandLineGit;
let worktrees: Worktrees;
let pullRequests: PullRequestsForTests;
let publishing: Publishing;
let taskCount = 0;
const variables = Object.fromEntries(
  Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
);
const text = {
  title: "Rename a device",
  body: "## Definition of Done\n\n- [x] The rename persists",
};

beforeAll(async () => {
  repository = await createTemporaryRepository();
  gitIn(repository.path, "fetch", "--quiet", "origin");
  gitIn(repository.path, "branch", "--quiet", "--set-upstream-to=origin/main", "main");
  git = new CommandLineGit(new RepositoryLocks());
  const commands = new ProjectCommandRunner(new ShellCommandRunner());
  worktrees = new Worktrees(
    git,
    commands,
    new OfficeDataDirectory(join(repository.folder, "office-data")),
  );
  pullRequests = new PullRequestsForTests();
  publishing = new Publishing(git, pullRequests, commands, worktrees);
});

beforeEach(() => {
  pullRequests.requests.length = 0;
  pullRequests.refusal = undefined;
  pullRequests.held = undefined;
});

afterAll(async () => {
  await repository.remove();
});

function aProjectPublishingBy(publishingMode: PublishingMode): Project {
  return aProject({ path: repository.path, publishingMode });
}

function pullRequestProject(): Project {
  return aProjectPublishingBy("push-and-pull-request");
}

function mergingProject(): Project {
  return aProjectPublishingBy("merge");
}

/** A Task whose branch, made at the fetched main, holds one commit adding `file`. */
async function aTaskWithACommit(
  project: Project,
  file = `task-${taskCount + 1}.txt`,
): Promise<{ taskId: string; branch: string; commit: string }> {
  taskCount += 1;
  const taskId = `task-${taskCount}`;
  const worktree = await worktrees.open(project, taskId);
  await writeFile(join(worktree.path, file), "from the Task\n");
  const commit = await git.commit(worktree.path, `Add ${file}`, variables);
  if (!commit) throw new Error("The Task's commit committed nothing.");
  return { taskId, branch: worktree.branch, commit };
}

/** The commit the origin's `branch` names; undefined when the origin has no such branch. */
function originCommitOf(branch: string): string | undefined {
  try {
    return gitIn(repository.originPath, "rev-parse", "--verify", "--quiet", `refs/heads/${branch}`);
  } catch {
    return undefined;
  }
}

describe("Publishing in push + PR mode", GIT_TIMEOUT, () => {
  it("pushes the Task's branch and opens a pull request into the base, in the record's words", async () => {
    const task = await aTaskWithACommit(pullRequestProject());

    const publication = await publishing.publish(
      pullRequestProject(),
      task.taskId,
      text,
      "publishing-mode",
    );

    expect(publication).toEqual({
      kind: "pull-request-opened",
      branch: task.branch,
      url: "https://github.com/notnullsoft/admin/pull/1",
    });
    expect(originCommitOf(task.branch)).toBe(task.commit);
    expect(pullRequests.requests).toEqual([
      { repositoryPath: repository.path, baseBranch: "main", branch: task.branch, ...text },
    ]);
    expect(gitIn(repository.path, "rev-parse", `refs/office/published-from/${task.taskId}`)).toBe(
      gitIn(repository.path, "rev-parse", `${task.commit}^`),
    );
  });

  it("holds the repository from the fetch to the pull request, so no git change lands between", async () => {
    const task = await aTaskWithACommit(pullRequestProject());
    const other = await worktrees.open(pullRequestProject(), "task-meanwhile");
    await writeFile(join(other.path, "meanwhile.txt"), "meanwhile\n");
    let release!: () => void;
    pullRequests.held = new Promise((resolve) => (release = resolve));
    const log: string[] = [];

    const publishingDone = publishing
      .publish(pullRequestProject(), task.taskId, text, "publishing-mode")
      .then(() => void log.push("published"));
    await expect.poll(() => pullRequests.requests.length, { timeout: 30_000 }).toBe(1);
    const committing = git
      .commit(other.path, "Add meanwhile.txt", variables)
      .then(() => void log.push("committed"));
    // Long enough for the commit to finish, were it not waiting.
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(log).toEqual([]);
    release();
    await Promise.all([publishingDone, committing]);

    expect(log).toEqual(["published", "committed"]);
  });

  it("opens the pull request when the base moved on but the branch still merges cleanly", async () => {
    const task = await aTaskWithACommit(pullRequestProject());
    await commitOnOrigin(repository, "main", `beside-${task.taskId}.txt`);

    await expect(
      publishing.publish(pullRequestProject(), task.taskId, text, "publishing-mode"),
    ).resolves.toMatchObject({
      kind: "pull-request-opened",
    });
  });

  it("fails with GitHub's words when the pull request is refused, the branch pushed", async () => {
    const task = await aTaskWithACommit(pullRequestProject());
    pullRequests.refusal = "GitHub didn't open the pull request: GraphQL: Resource not accessible.";

    await expect(
      publishing.publish(pullRequestProject(), task.taskId, text, "publishing-mode"),
    ).resolves.toEqual({
      kind: "failed",
      error: "GitHub didn't open the pull request: GraphQL: Resource not accessible.",
    });
    expect(originCommitOf(task.branch)).toBe(task.commit);
  });

  it("fails with the remote's words when the push is rejected, opening no pull request", async () => {
    const task = await aTaskWithACommit(pullRequestProject());
    const hook = join(repository.originPath, "hooks", "pre-receive");
    await writeFile(hook, "#!/bin/sh\necho 'protected branch' >&2\nexit 1\n", { mode: 0o755 });
    try {
      const publication = await publishing.publish(
        pullRequestProject(),
        task.taskId,
        text,
        "publishing-mode",
      );

      expect(publication).toMatchObject({ kind: "failed" });
      expect(publication.kind === "failed" && publication.error).toMatch(
        new RegExp(
          `^Pushing ${task.branch} to ${task.branch} on origin failed\\. git said: .*protected branch`,
          "s",
        ),
      );
    } finally {
      await rm(hook);
    }
    expect(pullRequests.requests).toEqual([]);
  });

  it("asks nothing of the remote when the branch would conflict with the base", async () => {
    const file = `conflict-${taskCount + 1}.txt`;
    const task = await aTaskWithACommit(pullRequestProject(), file);
    await commitOnOrigin(repository, "main", file);

    await expect(
      publishing.publish(pullRequestProject(), task.taskId, text, "publishing-mode"),
    ).resolves.toEqual({
      kind: "base-moved",
      error: `${task.branch} no longer applies cleanly on main on origin: it would conflict in\n- ${file}`,
      conflictedFiles: [file],
    });
    expect(originCommitOf(task.branch)).toBeUndefined();
    expect(pullRequests.requests).toEqual([]);
  });
});

describe("Publishing in merge mode", GIT_TIMEOUT, () => {
  it("moves the base on the remote to the Task's branch, leaving the user's checkout as it is", async () => {
    const localMain = gitIn(repository.path, "rev-parse", "main");
    const task = await aTaskWithACommit(mergingProject());

    const publication = await publishing.publish(
      mergingProject(),
      task.taskId,
      text,
      "publishing-mode",
    );

    expect(publication).toEqual({
      kind: "merged",
      branch: task.branch,
      into: { remote: "origin", branch: "main" },
      commit: task.commit,
      rebased: false,
    });
    expect(originCommitOf("main")).toBe(task.commit);
    expect(gitIn(repository.path, "rev-parse", "refs/remotes/origin/main")).toBe(task.commit);
    expect(gitIn(repository.path, "rev-parse", "main")).toBe(localMain);
    expect(gitIn(repository.path, "status", "--porcelain")).toBe("");
    expect(pullRequests.requests).toEqual([]);
  });

  it("has nothing to publish when it runs again after merging", async () => {
    const task = await aTaskWithACommit(mergingProject());
    await publishing.publish(mergingProject(), task.taskId, text, "publishing-mode");

    await expect(
      publishing.publish(mergingProject(), task.taskId, text, "publishing-mode"),
    ).resolves.toEqual({
      kind: "nothing-to-publish",
      branch: task.branch,
      base: { remote: "origin", branch: "main" },
    });
  });

  it("rebases the branch onto a base that moved on, then moves the base to it", async () => {
    const task = await aTaskWithACommit(mergingProject());
    const moved = await commitOnOrigin(repository, "main", `beside-${task.taskId}.txt`);

    const publication = await publishing.publish(
      mergingProject(),
      task.taskId,
      text,
      "publishing-mode",
    );

    const rebased = gitIn(repository.path, "rev-parse", `refs/heads/${task.branch}`);
    expect(publication).toEqual({
      kind: "merged",
      branch: task.branch,
      into: { remote: "origin", branch: "main" },
      commit: rebased,
      rebased: true,
    });
    expect(rebased).not.toBe(task.commit);
    expect(gitIn(repository.path, "rev-parse", `${rebased}^`)).toBe(moved);
    expect(originCommitOf("main")).toBe(rebased);
    const worktreePath = worktrees.pathOf(mergingProject(), task.taskId);
    expect(gitIn(worktreePath, "rev-parse", "HEAD")).toBe(rebased);
    expect(gitIn(worktreePath, "status", "--porcelain")).toBe("");
  });

  it("keeps what it shipped in the Task's changes after the base took the branch", async () => {
    const task = await aTaskWithACommit(mergingProject());
    const forkedFrom = await commitOnOrigin(repository, "main", `beside-${task.taskId}.txt`);

    await publishing.publish(mergingProject(), task.taskId, text, "publishing-mode");

    expect(gitIn(repository.path, "rev-parse", `refs/office/published-from/${task.taskId}`)).toBe(
      forkedFrom,
    );
    const changes = await worktrees.changes(mergingProject(), task.taskId);
    expect(changes.files.map(({ path }) => path)).toEqual([`${task.taskId}.txt`]);
  });

  it("names the conflicting files when the branch would conflict with the base", async () => {
    const file = `conflict-${taskCount + 1}.txt`;
    const task = await aTaskWithACommit(mergingProject(), file);
    await commitOnOrigin(repository, "main", file);

    await expect(
      publishing.publish(mergingProject(), task.taskId, text, "publishing-mode"),
    ).resolves.toMatchObject({
      kind: "base-moved",
      conflictedFiles: [file],
    });
  });
});

describe("Publishing the branch only", GIT_TIMEOUT, () => {
  it.each(["push-and-pull-request", "merge"] as const)(
    "pushes the Task's branch alone in %s mode, opening no pull request and leaving the base",
    async (publishingMode) => {
      const project = aProjectPublishingBy(publishingMode);
      const task = await aTaskWithACommit(project);
      const originMain = originCommitOf("main");

      const publication = await publishing.publish(project, task.taskId, text, "branch-only");

      expect(publication).toEqual({ kind: "branch-pushed", branch: task.branch, remote: "origin" });
      expect(originCommitOf(task.branch)).toBe(task.commit);
      expect(originCommitOf("main")).toBe(originMain);
      expect(pullRequests.requests).toEqual([]);
    },
  );

  it("pushes a branch the base moved past, as nothing is merged", async () => {
    const file = `conflict-${taskCount + 1}.txt`;
    const task = await aTaskWithACommit(pullRequestProject(), file);
    await commitOnOrigin(repository, "main", file);

    await expect(
      publishing.publish(pullRequestProject(), task.taskId, text, "branch-only"),
    ).resolves.toEqual({ kind: "branch-pushed", branch: task.branch, remote: "origin" });
    expect(originCommitOf(task.branch)).toBe(task.commit);
  });

  it("keeps what it pushed in the Task's changes once the worktree is gone", async () => {
    const task = await aTaskWithACommit(pullRequestProject());

    await publishing.publish(pullRequestProject(), task.taskId, text, "branch-only");
    await worktrees.remove(pullRequestProject(), task.taskId);

    const changes = await worktrees.changes(pullRequestProject(), task.taskId);
    expect(changes.files.map(({ path }) => path)).toEqual([`${task.taskId}.txt`]);
    expect(changes.worktreePath).toBeUndefined();
  });
});

describe("Publishing without a remote", GIT_TIMEOUT, () => {
  it("fails, saying the base branch tracks none", async () => {
    gitIn(repository.path, "branch", "--quiet", "--unset-upstream", "main");
    try {
      const project = aProjectPublishingBy("merge");
      const task = await aTaskWithACommit(project);

      await expect(
        publishing.publish(project, task.taskId, text, "publishing-mode"),
      ).resolves.toEqual({
        kind: "failed",
        error:
          "main tracks no remote branch, so Publish has nowhere to push. Set its upstream (`git branch --set-upstream-to=origin/main main`), then run Publish again.",
      });
    } finally {
      gitIn(repository.path, "branch", "--quiet", "--set-upstream-to=origin/main", "main");
    }
  });
});
