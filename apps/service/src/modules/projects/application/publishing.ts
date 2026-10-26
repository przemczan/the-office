import { Injectable } from "@nestjs/common";
import type { Project } from "../domain/project.js";
import {
  baseMovedError,
  noRemoteError,
  pushFailure,
  type Publication,
  type PullRequestText,
  type RemoteBranch,
} from "../domain/publication.js";
import { Git, GitCommandFailed, type GitVariables } from "../ports/git.js";
import { PullRequestRefused, PullRequests } from "../ports/pull-requests.js";
import { ProjectCommandRunner } from "./project-command-runner.js";
import { Worktrees } from "./worktrees.js";

/** Where a Publish takes the Task's branch: the base branch as its remote has it, freshly fetched. */
interface PublishTarget {
  readonly branch: string;
  readonly base: RemoteBranch;
  readonly baseCommit: string;
  readonly variables: GitVariables;
}

/**
 * Publish (spec §2.3, §9): The Office's own git takes a Task's committed branch to the remote its
 * base branch tracks, by the Project's publishing mode. Push + PR pushes the branch and opens a
 * pull request; merge moves the base branch on the remote to the branch, as a fast-forward only,
 * as the click-through's `git merge --ff-only` does. Both check first that the branch still applies
 * cleanly on the freshly fetched base, and run with the repository to themselves, so nothing moves
 * a ref between the check and the push. Pushes run with the Project's variables, which hold no
 * publishing token; git's own credential helper signs them in. The user's checkout and local
 * base branch are left as they are.
 */
@Injectable()
export class Publishing {
  constructor(
    private readonly git: Git,
    private readonly pullRequests: PullRequests,
    private readonly commands: ProjectCommandRunner,
    private readonly worktrees: Worktrees,
  ) {}

  async publish(project: Project, taskId: string, text: PullRequestText): Promise<Publication> {
    const branch = this.worktrees.branchOf(taskId);
    const base = await this.git.upstreamOf(project.path, project.baseBranch);
    if (!base) return { kind: "failed", error: noRemoteError(project.baseBranch) };
    const variables = this.commands.variablesFor(project.environment);
    return this.git
      .exclusively(project.path, async () => {
        const baseCommit = await this.git
          .fetch(project.path, base, variables)
          .catch((error: unknown) => {
            throw failure(
              error,
              (said) => `Fetching ${base.branch} from ${base.remote} failed. git said: ${said}`,
            );
          });
        const target: PublishTarget = { branch, base, baseCommit, variables };
        if (await this.git.contains(project.path, baseCommit, branchRef(branch))) {
          return { kind: "nothing-to-publish", branch, base } as const;
        }
        return project.publishingMode === "merge"
          ? this.merge(project, target)
          : this.pushAndOpenPullRequest(project, target, text);
      })
      .catch((error: unknown) => {
        if (error instanceof PublishFailed)
          return { kind: "failed", error: error.message } as const;
        throw error;
      });
  }

  private async pushAndOpenPullRequest(
    project: Project,
    target: PublishTarget,
    { title, body }: PullRequestText,
  ): Promise<Publication> {
    const moved = await this.baseMoved(project, target, { onlyOnConflicts: true });
    if (moved) return moved;
    const { branch, base } = target;
    await this.push(project, target, { remote: base.remote, branch });
    const pullRequest = await this.pullRequests
      .open({ repositoryPath: project.path, baseBranch: base.branch, branch, title, body })
      .catch((error: unknown) => {
        if (error instanceof PullRequestRefused) throw new PublishFailed(error.message);
        throw error;
      });
    return { kind: "pull-request-opened", branch, url: pullRequest.url };
  }

  private async merge(project: Project, target: PublishTarget): Promise<Publication> {
    const moved = await this.baseMoved(project, target, { onlyOnConflicts: false });
    if (moved) return moved;
    await this.push(project, target, target.base);
    const commit = await this.git.commitOf(project.path, branchRef(target.branch));
    return { kind: "merged", branch: target.branch, into: target.base, commit };
  }

  /**
   * The branch no longer applying cleanly on the fetched base: it would conflict, or, unless
   * `onlyOnConflicts`, it isn't a fast-forward of the base any more. Undefined when it applies.
   */
  private async baseMoved(
    project: Project,
    { branch, base, baseCommit }: PublishTarget,
    { onlyOnConflicts }: { readonly onlyOnConflicts: boolean },
  ): Promise<Publication | undefined> {
    const ref = branchRef(branch);
    const conflictedFiles = await this.git.conflictsOf(project.path, baseCommit, ref);
    if (conflictedFiles.length === 0) {
      if (onlyOnConflicts || (await this.git.contains(project.path, ref, baseCommit))) {
        return undefined;
      }
    }
    return {
      kind: "base-moved",
      error: baseMovedError(branch, base, conflictedFiles),
      conflictedFiles,
    };
  }

  private async push(
    project: Project,
    { branch, variables }: PublishTarget,
    into: RemoteBranch,
  ): Promise<void> {
    await this.git.push(project.path, branch, into, variables).catch((error: unknown) => {
      throw failure(error, (said) => pushFailure(branch, into, said));
    });
  }
}

/** A step of Publish that failed in a way the Stage's on-failure target or the user handles. */
class PublishFailed extends Error {}

/** git's refusal as a PublishFailed in `words`; anything else is a fault and stays as it is. */
function failure(error: unknown, words: (said: string) => string): unknown {
  return error instanceof GitCommandFailed ? new PublishFailed(words(error.detail)) : error;
}

function branchRef(branch: string): string {
  return `refs/heads/${branch}`;
}
