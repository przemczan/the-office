import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import { TaskStateChanged } from "../../work/index.js";
import { StartedTasks } from "../ports/started-tasks.js";
import { TaskGit } from "../ports/task-git.js";
import { TaskRecords } from "../ports/task-records.js";
import { InitiativeBranchStages } from "./initiative-branch-stages.js";
import { StageRunsFiles } from "./stage-runs-files.js";

/**
 * A dropped Publishing Task's worktree goes, holding its Initiative's branch so no Stage of it
 * runs meanwhile, and its folder of the file of its earlier Stage runs with it; the branch stays,
 * so the next Publishing Task can check it out (spec 2.1).
 */
@Injectable()
export class DroppedPublishingTasks implements OnModuleInit {
  private readonly logger = new Logger(DroppedPublishingTasks.name);

  constructor(
    private readonly tasks: StartedTasks,
    private readonly records: TaskRecords,
    private readonly git: TaskGit,
    private readonly branchStages: InitiativeBranchStages,
    private readonly events: EventBus,
    private readonly stageRunsFiles: StageRunsFiles,
  ) {}

  onModuleInit(): void {
    this.events.subscribe(TaskStateChanged, async ({ taskId, to }) => {
      if (to === "dropped") await this.removeWorktree(taskId);
    });
  }

  /** A worktree that stays is only logged: the next Publishing Task's Start says why it can't. */
  private async removeWorktree(taskId: string): Promise<void> {
    try {
      if ((await this.tasks.read(taskId)).madeFor !== "publishing") return;
      const task = await this.records.read(taskId);
      await this.branchStages.holding(task, () => this.git.removeWorktree(task.project.id, taskId));
      await this.stageRunsFiles.remove(taskId);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Dropped Publishing Task ${taskId}'s worktree stays: ${reason}`);
    }
  }
}
