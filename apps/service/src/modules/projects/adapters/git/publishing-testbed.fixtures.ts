import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { officeIdentityForTests } from "../../../../platform/git-identity/office-identity.fixtures.js";
import { OfficeDataDirectory } from "../../../../platform/office-data/office-data-directory.js";
import { CommandLineGit } from "./command-line-git.js";
import { serviceVariables } from "./command-line-git.fixtures.js";
import { RepositoryLocks } from "./repository-locks.js";
import {
  createTemporaryRepository,
  gitIn,
  type TemporaryRepository,
} from "./temporary-repository.fixtures.js";
import { ShellCommandRunner } from "../shell/shell-command-runner.js";
import type { Project, PublishingMode } from "../../domain/project.js";
import { aProject } from "../../domain/project.fixtures.js";
import type { PullRequestText } from "../../domain/publication.js";
import {
  PullRequestRefused,
  PullRequests,
  type PullRequest,
  type PullRequestRequest,
} from "../../ports/pull-requests.js";
import { ProjectCommandRunner } from "../../application/project-command-runner.js";
import { Publishing } from "../../application/publishing.js";
import { Worktrees } from "../../application/worktrees.js";

/** Several real git commands a test, slower while every test file runs at once. */
export const PUBLISHING_TEST = { timeout: 30_000 } as const;

export const pullRequestText: PullRequestText = {
  title: "Rename a device",
  body: "## Definition of Done\n\n- [x] The rename persists",
};

/** GitHub in memory: each request opens a pull request, unless a test refuses, blocks or holds it. */
export class PullRequestsForTests extends PullRequests {
  readonly requests: PullRequestRequest[] = [];
  readonly askedWhy: string[] = [];
  refusal: string | undefined = undefined;
  /** Why no pull request can be opened, asked before the push. */
  blocker: string | undefined = undefined;
  /** Set while the next request waits until the test lets it go on. */
  held: Promise<void> | undefined = undefined;

  async whyCannotOpen(remoteUrl: string): Promise<string | undefined> {
    this.askedWhy.push(remoteUrl);
    return this.blocker;
  }

  async open(request: PullRequestRequest): Promise<PullRequest> {
    this.requests.push(request);
    await this.held;
    if (this.refusal) throw new PullRequestRefused(this.refusal);
    return { url: `https://github.com/notnullsoft/admin/pull/${this.requests.length}` };
  }

  /** Forgets every request and opens each pull request again. */
  reset(): void {
    this.requests.length = 0;
    this.askedWhy.length = 0;
    this.refusal = undefined;
    this.blocker = undefined;
    this.held = undefined;
  }
}

/**
 * Publishing with real git on a temporary repository whose main tracks its origin's, which is a
 * bare repository, and GitHub in memory.
 */
export class PublishingTestbed {
  private tasks = 0;

  private constructor(
    readonly repository: TemporaryRepository,
    readonly git: CommandLineGit,
    readonly worktrees: Worktrees,
    readonly pullRequests: PullRequestsForTests,
    readonly publishing: Publishing,
  ) {}

  static async create(): Promise<PublishingTestbed> {
    const repository = await createTemporaryRepository();
    gitIn(repository.path, "fetch", "--quiet", "origin");
    gitIn(repository.path, "branch", "--quiet", "--set-upstream-to=origin/main", "main");
    const git = new CommandLineGit(new RepositoryLocks(), officeIdentityForTests());
    const commands = new ProjectCommandRunner(new ShellCommandRunner());
    const worktrees = new Worktrees(
      git,
      commands,
      new OfficeDataDirectory(join(repository.folder, "office-data")),
    );
    const pullRequests = new PullRequestsForTests();
    const publishing = new Publishing(git, pullRequests, commands, worktrees);
    return new PublishingTestbed(repository, git, worktrees, pullRequests, publishing);
  }

  /** How many Tasks it has made; part of each Task's id. */
  get taskCount(): number {
    return this.tasks;
  }

  aProjectPublishingBy(publishingMode: PublishingMode): Project {
    return aProject({ path: this.repository.path, publishingMode });
  }

  pullRequestProject(): Project {
    return this.aProjectPublishingBy("push-and-pull-request");
  }

  mergingProject(): Project {
    return this.aProjectPublishingBy("merge");
  }

  /** A Task whose branch, made at the fetched main, holds one commit adding `file`. */
  async aTaskWithACommit(
    project: Project,
    file = `task-${this.tasks + 1}.txt`,
  ): Promise<{ taskId: string; branch: string; commit: string }> {
    this.tasks += 1;
    const taskId = `task-${this.tasks}`;
    const worktree = await this.worktrees.open(project, taskId);
    await writeFile(join(worktree.path, file), "from the Task\n");
    const commit = await this.git.commit(worktree.path, `Add ${file}`, serviceVariables);
    if (!commit) throw new Error("The Task's commit committed nothing.");
    return { taskId, branch: worktree.branch, commit };
  }

  /** The URL git resolves for the origin, which the pull request is asked of. */
  originUrl(): Promise<string> {
    return this.git.fetchUrlOf(this.repository.path, "origin");
  }

  /** The commit the origin's `branch` names; undefined when the origin has no such branch. */
  originCommitOf(branch: string): string | undefined {
    try {
      return gitIn(
        this.repository.originPath,
        "rev-parse",
        "--verify",
        "--quiet",
        `refs/heads/${branch}`,
      );
    } catch {
      return undefined;
    }
  }

  remove(): Promise<void> {
    return this.repository.remove();
  }
}
