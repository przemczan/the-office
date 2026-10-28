import { Injectable, Logger } from "@nestjs/common";
import { publishOutcome, pullRequestText } from "../domain/publish.js";
import type { StageOutcome } from "../domain/stage-run.js";
import { TaskGit } from "../ports/task-git.js";
import { TaskPublishing } from "../ports/task-publishing.js";
import { TaskRecords } from "../ports/task-records.js";
import { TaskThreadSessions } from "../ports/task-thread-sessions.js";
import { StageGit } from "./stage-git.js";
import type { StageWork } from "./stage-runner.js";

/**
 * Runs a Publish Stage (spec §2.3): a Script Stage The Office runs with its own git rather than a
 * Project command, with no model call. It publishes the Task's committed branch by the Project's
 * publishing mode, a pull request worded from the Task's record, or pushes the branch only when the
 * Stage's target says so (a proof of concept); once it has published, the
 * worktree goes; the branch keeps the work for any Stage after it. Its failures go where any
 * Script Stage's go; a base that moved on asks the user (`afterBaseMoved`).
 */
@Injectable()
export class PublishStage {
  private readonly logger = new Logger(PublishStage.name);

  constructor(
    private readonly records: TaskRecords,
    private readonly publishing: TaskPublishing,
    private readonly git: TaskGit,
    private readonly stageGit: StageGit,
    private readonly threadSessions: TaskThreadSessions,
  ) {}

  async run(work: StageWork<"script">): Promise<StageOutcome> {
    const { stage, run, stages, earlierRuns } = work;
    const task = await this.records.read(run.taskId);
    const { expected, refusal } = await this.stageGit.start(work, task);
    if (refusal) return refusal;
    const text = pullRequestText(task, stages, earlierRuns, stage.key);
    const publication = await this.publishing.publish(
      task.project.id,
      run.taskId,
      text,
      stage.publishTarget ?? "publishing-mode",
    );
    const outcome = publishOutcome(publication);
    // A merge may have rebased the branch: the next Stage expects HEAD where Publish left it.
    const left = publication.kind === "merged" ? publication.commit : expected.commit;
    await this.stageGit.leaveAt(run, { ...expected, commit: left });
    if (outcome.status !== "done") return outcome;
    return {
      ...outcome,
      summary: `${outcome.summary}${await this.removeWorktree(task.project.id, run.taskId)}`,
    };
  }

  /**
   * Removes the worktree once no waiting session works in it, such as the Planner's; one that
   * stays, as a session still answering keeps it, is no failure of what was published, only told of.
   */
  private async removeWorktree(projectId: string, taskId: string): Promise<string> {
    try {
      await this.threadSessions.endWaiting(taskId);
      await this.git.removeWorktree(projectId, taskId);
      return "";
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Task ${taskId}'s worktree stays after Publish: ${reason}`);
      return `\n\nThe Office couldn't remove the Task's worktree, which stays: ${reason}`;
    }
  }
}
