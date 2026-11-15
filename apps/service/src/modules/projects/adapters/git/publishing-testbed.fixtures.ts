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
import type { CommitMessage } from "../../domain/publication.js";
import {
  PullRequestRefused,
  PullRequests,
  type PullRequest,
  type PullRequestRequest,
} from "../../ports/pull-requests.js";
import { ProjectCommandRunner } from "../../application/project-command-runner.js";
import { Publishing } from "../../application/publishing.js";
import { Worktrees } from "../../application/worktrees.js";
import { taskCommandsOver } from "../../application/task-command-runner.fixtures.js";
import { TaskBasesForTests } from "../../application/task-bases.fixtures.js";

/** Several real git commands a test, slower while every test file runs at once. */
export const PUBLISHING_TEST = { timeout: 30_000 } as const;

export const commitMessage: CommitMessage = {
  subject: "Rename a device",
  body: "Adds a rename dialog to the device page.",
  whole: "Rename a device\n\nAdds a rename dialog to the device page.",
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
    readonly taskBases: TaskBasesForTests,
  ) {}

  static async create(): Promise<PublishingTestbed> {
    const repository = await createTemporaryRepository();
    gitIn(repository.path, "fetch", "--quiet", "origin");
    gitIn(repository.path, "branch", "--quiet", "--set-upstream-to=origin/main", "main");
    const git = new CommandLineGit(new RepositoryLocks(), officeIdentityForTests());
    const commands = new ProjectCommandRunner(new ShellCommandRunner());
    const taskBases = new TaskBasesForTests(git);
    const worktrees = new Worktrees(
      git,
      commands,
      taskCommandsOver(commands, git),
      new OfficeDataDirectory(join(repository.folder, "office-data")),
      taskBases,
    );
    const pullRequests = new PullRequestsForTests();
    const publishing = new Publishing(git, pullRequests, commands, worktrees, taskBases);
    return new PublishingTestbed(repository, git, worktrees, pullRequests, publishing, taskBases);
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

  /**
   * A Task whose branch, made at the fetched main, or at its Initiative's branch when given one,
   * holds one commit adding `file`.
   */
  async aTaskWithACommit(
    project: Project,
    file = `task-${this.tasks + 1}.txt`,
    initiativeBranch?: string,
  ): Promise<{ taskId: string; branch: string; commit: string }> {
    this.tasks += 1;
    const taskId = `task-${this.tasks}`;
    if (initiativeBranch !== undefined)
      this.taskBases.initiativeBranches.set(taskId, initiativeBranch);
    const worktree = await this.worktrees.open(project, taskId);
    await writeFile(join(worktree.path, file), "from the Task\n");
    const commit = await this.git.commit(worktree.path, `Add ${file}`, serviceVariables);
    if (!commit) throw new Error("The Task's commit committed nothing.");
    return { taskId, branch: worktree.branch, commit };
  }

  /**
   * Makes the Initiative's branch `initiative/<shortName>` at the origin's main, as Confirm does,
   * and pushes it there too when `pushed`, as its first Publish would.
   */
  anInitiativeBranch(shortName: string, { pushed = false } = {}): string {
    const branch = `initiative/${shortName}`;
    gitIn(this.repository.path, "fetch", "--quiet", "origin");
    gitIn(this.repository.path, "branch", branch, "origin/main");
    if (pushed) gitIn(this.repository.path, "push", "--quiet", "origin", branch);
    return branch;
  }

  /** The commit the local `branch` names; undefined when there is no such branch. */
  localCommitOf(branch: string): string | undefined {
    try {
      return gitIn(
        this.repository.path,
        "rev-parse",
        "--verify",
        "--quiet",
        `refs/heads/${branch}`,
      );
    } catch {
      return undefined;
    }
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
