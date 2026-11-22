import { Injectable } from "@nestjs/common";
import type { Project } from "../domain/project.js";
import { InitiativeBranchUnusable } from "../domain/task-base.js";
import { Git, GitCommandFailed, type GitVariables, type Upstream } from "../ports/git.js";
import { BranchDeletions } from "./branch-deletions.js";
import { ProjectCommandRunner } from "./project-command-runner.js";
import { ProjectRemotes } from "./project-remotes.js";
import { ProjectService } from "./project-service.js";
import { TaskBases } from "./task-bases.js";
import { Worktrees, type BaseBranch } from "./worktrees.js";

/** How making an Initiative's branch in a Project went: made at a commit, or refused with why. */
export type InitiativeBranchMaking =
  | { readonly kind: "made"; readonly commit: string }
  | { readonly kind: "refused"; readonly reason: string };

/** How removing an Initiative's branch from a Project went: removed, or refused with why. */
export type InitiativeBranchRemoval =
  { readonly kind: "removed" } | { readonly kind: "refused"; readonly reason: string };

/**
 * An Initiative's branch in a Project (spec §5.5 Defaults, "The Initiative's branch"): made at the
 * freshly fetched base branch, only when the name is free here and on the base branch's remote.
 * Nothing is pushed here; a branch the same attempt made can be taken back, and Back to Shaping
 * removes one that holds nothing beyond the base. Whether a branch holds work not yet published is
 * asked of it too.
 */
@Injectable()
export class InitiativeBranches {
  constructor(
    private readonly projects: ProjectService,
    private readonly git: Git,
    private readonly worktrees: Worktrees,
    private readonly commands: ProjectCommandRunner,
    private readonly remotes: ProjectRemotes,
    private readonly taskBases: TaskBases,
    private readonly deletions: BranchDeletions,
  ) {}

  /**
   * Makes the local branch `branch` at the base branch's freshly fetched commit, or locally when it
   * tracks no remote branch. Refused when the branch exists here or on the remote, or the fetch
   * fails; the ref is made only if absent, so two makings of one name can't both succeed.
   */
  async make(projectId: string, branch: string): Promise<InitiativeBranchMaking> {
    const project = await this.projects.read(projectId);
    if (await this.git.hasBranch(project.path, branch)) return taken(project, branch);
    const variables = this.commands.variablesFor(project.environment);
    let base: BaseBranch;
    try {
      base = await this.worktrees.freshBase(project, variables);
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      return refused(
        `The base branch of ${project.name} couldn't be fetched: ${await this.remotes.reasonOf(project, error)}`,
      );
    }
    if (base.fetchedFrom) {
      const onRemote = await this.onRemote(
        project,
        { remote: base.fetchedFrom.remote, branch },
        variables,
      );
      if (onRemote !== undefined) return onRemote;
    }
    try {
      await this.git.createRef(project.path, refOf(branch), base.commit);
    } catch (error) {
      if (!(error instanceof GitCommandFailed)) throw error;
      // Made meanwhile, or a name git doesn't take.
      return (await this.git.hasBranch(project.path, branch))
        ? taken(project, branch)
        : refused(`The branch ${branch} couldn't be made in ${project.name}: ${error.detail}`);
    }
    return { kind: "made", commit: base.commit };
  }

  /** Removes the branch only while it still names `commit`: the one the same attempt made. */
  async remove(projectId: string, branch: string, commit: string): Promise<void> {
    const project = await this.projects.read(projectId);
    await this.git.removeRef(project.path, refOf(branch), commit);
  }

  /**
   * Removes `branch`, here and on the base branch's remote, only while neither copy holds a commit
   * the freshly fetched base branch doesn't have (Back to Shaping), as `BranchDeletions` judges it;
   * refused, with the Project named, when one does or git fails. A copy that is gone already is
   * left gone. Never run inside a database hold: it fetches and pushes.
   */
  async removeEmpty(projectId: string, branch: string): Promise<InitiativeBranchRemoval> {
    const project = await this.projects.read(projectId);
    try {
      const deletion = await this.deletions.deleteHoldingNothing(project, branch, {
        kind: "initiative",
        tasks: [],
      });
      return deletion.kind === "deleted" ? { kind: "removed" } : deletion;
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      return refused(
        `The branch ${branch} couldn't be removed from ${project.name}: ${await this.remotes.reasonOf(project, error)}`,
      );
    }
  }

  /** Whether the Project's repository has the local branch `branch`. */
  async exists(projectId: string, branch: string): Promise<boolean> {
    const project = await this.projects.read(projectId);
    return this.git.hasBranch(project.path, branch);
  }

  /**
   * Whether `branch`, fetched with the base branch, holds commits not yet published: commits the
   * Publishing Task `publishedByTaskId` didn't publish (`Worktrees.publishedRefOf`), or, with none
   * given, commits the freshly fetched base branch doesn't have. True when unsure, as when the
   * branch is gone or has diverged from its remote's, or git fails, so no work is left unpublished
   * unseen. Never run inside a database hold: it fetches.
   */
  async holdsUnpublished(
    projectId: string,
    branch: string,
    publishedByTaskId?: string,
  ): Promise<boolean> {
    const project = await this.projects.read(projectId);
    const variables = this.commands.variablesFor(project.environment);
    try {
      return await this.git.exclusively(project.path, async () => {
        const base = await this.worktrees.freshBase(project, variables);
        const { commit } = await this.taskBases.freshInitiativeBranch(project, branch, variables);
        const published =
          publishedByTaskId === undefined
            ? base.commit
            : await this.git.findCommit(
                project.path,
                this.worktrees.publishedRefOf(publishedByTaskId),
              );
        if (published === undefined) return true;
        return !(await this.git.contains(project.path, published, commit));
      });
    } catch (error) {
      if (error instanceof GitCommandFailed || error instanceof InitiativeBranchUnusable) {
        return true;
      }
      throw error;
    }
  }

  /** A refusal when the remote has the branch or can't be asked; undefined when it is free there. */
  private async onRemote(
    project: Project,
    upstream: Upstream,
    variables: GitVariables,
  ): Promise<InitiativeBranchMaking | undefined> {
    try {
      if (!(await this.git.remoteHasBranch(project.path, upstream, variables))) return undefined;
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      return refused(
        `The remote of ${project.name} couldn't be asked for the branch ${upstream.branch}: ${await this.remotes.reasonOf(project, error)}`,
      );
    }
    return refused(
      `The branch ${upstream.branch} already exists on the remote of ${project.name}.`,
    );
  }
}

function refOf(branch: string): string {
  return `refs/heads/${branch}`;
}

function taken(project: Project, branch: string): InitiativeBranchMaking {
  return refused(`The branch ${branch} already exists in ${project.name}.`);
}

function refused(reason: string): { readonly kind: "refused"; readonly reason: string } {
  return { kind: "refused", reason };
}
