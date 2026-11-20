import { Injectable } from "@nestjs/common";
import type { Project } from "../domain/project.js";
import {
  existingBranchUnusable,
  type ExistingBranchKind,
  type FreshInitiativeBranch,
  type TaskBase,
} from "../domain/task-base.js";
import { Git, type GitVariables } from "../ports/git.js";

/** The prefix of a Task's own branch, `office/<task>`. */
const TASK_BRANCH_PREFIX = "office/";

/** What a Task's branch starts from and publishes into, by the Task's own records. */
export type TaskBaseLookup = (projectId: string, taskId: string) => Promise<TaskBase>;

/**
 * What each Task's branch starts from and publishes into (spec §5.5, "A worktree per Task"),
 * looked up by Work, which registers it as it starts: Work reads its Tasks through Projects, so
 * Projects can't ask it directly (the module template's registry).
 */
@Injectable()
export class TaskBases {
  private lookup: TaskBaseLookup | undefined;

  constructor(private readonly git: Git) {}

  register(lookup: TaskBaseLookup): void {
    this.lookup = lookup;
  }

  /**
   * The Task's base. Throws when nothing is registered: falling back to the base branch would
   * publish an Initiative's Task into it.
   */
  async of(project: Project, taskId: string): Promise<TaskBase> {
    if (!this.lookup) throw new Error("No lookup of a Task's base is registered.");
    return this.lookup(project.id, taskId);
  }

  /**
   * The branch the Task's worktree holds: its own `office/<task>`; for a Publishing Task, its
   * Initiative's branch itself (spec §2.3, "A Publishing Task's Publish"); for a Conflict
   * resolution Task, the branch of the pull request it resolves, the branch of the Task that
   * opened it (`office/<that task>`, or an Initiative's branch for a Publishing Task's).
   */
  async branchOfTask(project: Project, taskId: string): Promise<string> {
    const taskBase = await this.of(project, taskId);
    switch (taskBase.kind) {
      case "publishing-task":
        return taskBase.branch;
      case "pull-request":
        if (taskBase.taskId === taskId) throw new Error(`Task ${taskId} can't resolve itself.`);
        return this.branchOfTask(project, taskBase.taskId);
      case "base-branch":
      case "initiative-branch":
        return `${TASK_BRANCH_PREFIX}${taskId}`;
    }
  }

  /**
   * The newest commit of the Initiative's branch `branch` known here, without fetching: its local
   * branch, or its copy last fetched from the base branch's remote when that holds the local one.
   * Undefined when neither is here.
   */
  async knownInitiativeBranch(project: Project, branch: string): Promise<string | undefined> {
    const local = await this.git.findCommit(project.path, `refs/heads/${branch}`);
    const upstream = await this.git.upstreamOf(project.path, project.baseBranch);
    const fetched =
      upstream &&
      (await this.git.findCommit(project.path, `refs/remotes/${upstream.remote}/${branch}`));
    if (!fetched) return local;
    if (local === undefined || (await this.git.contains(project.path, fetched, local)))
      return fetched;
    return local;
  }

  /**
   * The Initiative's branch `branch` with its copy on the base branch's remote fetched, when the
   * base branch tracks one and the remote has it. Refused (InitiativeBranchUnusable) when the
   * local branch is gone, or the two have diverged; never merged here.
   */
  freshInitiativeBranch(
    project: Project,
    branch: string,
    variables: GitVariables,
  ): Promise<FreshInitiativeBranch> {
    return this.freshExistingBranch(project, branch, variables, "initiative");
  }

  /**
   * A branch that isn't a Task's own (an Initiative's, or a pull request's), with its copy on the
   * base branch's remote fetched as `freshInitiativeBranch` does, refused in the words of `kind`
   * (ExistingBranchUnusable) when the local branch is gone or the two have diverged.
   */
  async freshExistingBranch(
    project: Project,
    branch: string,
    variables: GitVariables,
    kind: ExistingBranchKind,
  ): Promise<FreshInitiativeBranch> {
    const unusable = existingBranchUnusable[kind];
    const local = await this.git.findCommit(project.path, `refs/heads/${branch}`);
    if (local === undefined) throw unusable.gone(branch, project.name);
    const upstream = await this.git.upstreamOf(project.path, project.baseBranch);
    if (!upstream) return { branch, commit: local, local, remote: undefined };
    const remote = { remote: upstream.remote, branch };
    if (!(await this.git.remoteHasBranch(project.path, remote, variables))) {
      return { branch, commit: local, local, remote };
    }
    const fetched = await this.git.fetch(project.path, remote, variables);
    if (await this.git.contains(project.path, fetched, local)) {
      return { branch, commit: fetched, local, remote };
    }
    if (await this.git.contains(project.path, local, fetched)) {
      return { branch, commit: local, local, remote };
    }
    throw unusable.diverged(branch, upstream.remote, project.name);
  }
}
