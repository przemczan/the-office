import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import { TaskStateChanged } from "../../work/index.js";
import { StartedTasks } from "../ports/started-tasks.js";
import { TaskGit } from "../ports/task-git.js";
import { TaskRecords } from "../ports/task-records.js";
import { InitiativeBranchStages } from "./initiative-branch-stages.js";
import { ResolveStageGit } from "./resolve-stage-git.js";
import { StageRunsFiles } from "./stage-runs-files.js";

/**
 * What The Office made the Tasks for whose worktree holds a branch that outlives them: a Publishing
 * Task's holds its Initiative's branch, a Conflict resolution Task's its pull request's branch.
 */
const ON_EXISTING_BRANCHES: ReadonlySet<string> = new Set(["publishing", "resolve-conflicts"]);

/**
 * A dropped Task's worktree is first given back from a merge left in progress, so its branch stays
 * as its last commit left it (`ResolveStageGit.abandonMerge`). A dropped Publishing Task's or
 * Conflict resolution Task's worktree then goes, and its folder of the file of its earlier Stage
 * runs with it; the branch stays, so the next Publishing Task can check it out (spec 2.1), or the
 * pull request keeps it. A Publishing Task's goes holding its Initiative's branch, so no Stage of it
 * runs meanwhile; a Conflict resolution Task belongs to no Initiative.
 */
@Injectable()
export class DroppedTaskWorktrees implements OnModuleInit {
  private readonly logger = new Logger(DroppedTaskWorktrees.name);

  constructor(
    private readonly tasks: StartedTasks,
    private readonly records: TaskRecords,
    private readonly git: TaskGit,
    private readonly resolveGit: ResolveStageGit,
    private readonly branchStages: InitiativeBranchStages,
    private readonly events: EventBus,
    private readonly stageRunsFiles: StageRunsFiles,
  ) {}

  onModuleInit(): void {
    this.events.subscribe(TaskStateChanged, async ({ taskId, to }) => {
      if (to !== "dropped") return;
      // One after the other: the merge is aborted in the worktree before the worktree goes.
      await this.resolveGit.abandonMerge(taskId);
      await this.removeWorktree(taskId);
    });
  }

  /** A worktree that stays is only logged: the next Task's Start on its branch says why it can't. */
  private async removeWorktree(taskId: string): Promise<void> {
    try {
      const { madeFor } = await this.tasks.read(taskId);
      if (madeFor === undefined || !ON_EXISTING_BRANCHES.has(madeFor)) return;
      const task = await this.records.read(taskId);
      await this.branchStages.holding(task, () => this.git.removeWorktree(task.project.id, taskId));
      await this.stageRunsFiles.remove(taskId);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Dropped Task ${taskId}'s worktree stays: ${reason}`);
    }
  }
}
