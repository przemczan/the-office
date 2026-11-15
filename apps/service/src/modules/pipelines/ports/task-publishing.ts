import type { CommitMessage, Publication, ResolveEnd, ResolveStart } from "../domain/publish.js";
import type { PublishTarget } from "../domain/stage.js";

/**
 * Publish by the Project's publishing mode (spec §9), landing the Task as one commit with its commit
 * message or opening a pull request worded from it, or push the branch only as a Publish Stage's
 * target may say (spec §2.3), which Projects runs with The Office's own git and the user's
 * credentials, out of every Agent's reach; and the git of Resolve, when Publish's branch conflicts
 * with the base. The composition root binds it.
 */
export abstract class TaskPublishing {
  abstract publish(
    projectId: string,
    taskId: string,
    message: CommitMessage,
    target: PublishTarget,
  ): Promise<Publication>;

  /**
   * Resolve's start (spec §2.3, "Conflicts at Publish"): merges the freshly fetched base into the
   * Task's branch, leaving the conflicted files in its worktree for the Task's person to edit. A
   * merge already in progress there is taken as it is.
   */
  abstract startResolve(projectId: string, taskId: string): Promise<ResolveStart>;

  /** Commits Resolve's merge as one merge commit, unless a conflict marker remains. */
  abstract finishResolve(projectId: string, taskId: string): Promise<ResolveEnd>;

  /** Gives the Task's worktree and branch back as they were before Resolve's merge began. */
  abstract abandonResolve(projectId: string, taskId: string): Promise<void>;
}
