import { Injectable } from "@nestjs/common";
import { withFixes } from "../domain/issue-fixes.js";
import type { Project } from "../domain/project.js";
import { isFeatureOn, ISSUES_FEATURE } from "../domain/project-features.js";
import type { CommitMessage } from "../domain/publication.js";
import type { TaskBase } from "../domain/task-base.js";
import { Git } from "../ports/git.js";
import { IssueLinkRepository } from "../ports/issue-link-repository.js";
import { IssueTasks } from "./issue-tasks.js";

/**
 * "Close the issue when the Task is Done" (docs/design/issues-as-tasks.html): what Publish lands
 * names each issue the Task was imported from in the same repository with a `Fixes #n` line, so the
 * code host closes it once the change reaches its default branch. A Publishing Task names its
 * Initiative's Tasks' issues in its Project too, as its merge or pull request is what reaches the
 * default branch.
 */
@Injectable()
export class IssueFixes {
  constructor(
    private readonly links: IssueLinkRepository,
    private readonly git: Git,
    private readonly issueTasks: IssueTasks,
  ) {}

  /**
   * The message with the Task's `Fixes #n` lines; as it is with the switch off, the Project's GitHub
   * issues switched off, or no issue.
   */
  async of(
    project: Project,
    taskId: string,
    taskBase: TaskBase,
    message: CommitMessage,
  ): Promise<CommitMessage> {
    if (!project.issueSettings.closeOnDone || !isFeatureOn(project, ISSUES_FEATURE)) {
      return message;
    }
    const upstream = await this.git.upstreamOf(project.path, project.baseBranch);
    if (!upstream) return message;
    const remoteUrl = await this.git.fetchUrlOf(project.path, upstream.remote);
    const taskIds =
      taskBase.kind === "publishing-task"
        ? [taskId, ...(await this.issueTasks.initiativeTasksOf(taskId))]
        : [taskId];
    const numbers = (await this.links.ofTasks(taskIds))
      .filter((link) => link.projectId === project.id && link.remoteUrl === remoteUrl)
      .map((link) => link.number);
    return withFixes(message, numbers);
  }
}
