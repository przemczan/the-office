import { Injectable } from "@nestjs/common";
import {
  KnownWorkLevels,
  type TaskOnWorkLevels,
  type WorkCascadeLevels,
  type WorkLevelsOf,
} from "../../../people/index.js";
import { tasksOnTheirEngines } from "../../domain/work-engine.js";
import { InitiativeRepository } from "../../ports/initiative-repository.js";
import { TaskRepository } from "../../ports/task-repository.js";

/**
 * Gives People's engine cascade the engines a Task and an Initiative set (spec 5.4.5): for a Task,
 * its own and its Initiative's; for an Initiative, its own; none for one there is none of. Read
 * straight from Work's tables, in `WorkEngineLevelsModule`, as Work reaches the cascade itself.
 */
@Injectable()
export class WorkEngineLevels extends KnownWorkLevels {
  constructor(
    private readonly tasks: TaskRepository,
    private readonly initiatives: InitiativeRepository,
  ) {
    super();
  }

  async engineLevelsOf(of: WorkLevelsOf): Promise<WorkCascadeLevels> {
    if ("initiativeId" in of) {
      const initiative = await this.initiatives.find(of.initiativeId);
      return { taskEngine: null, initiativeEngine: initiative?.engine ?? null };
    }
    const task = await this.tasks.find(of.taskId);
    if (!task) return { taskEngine: null, initiativeEngine: null };
    const initiative =
      task.initiativeId === undefined ? undefined : await this.initiatives.find(task.initiativeId);
    return { taskEngine: task.engine, initiativeEngine: initiative?.engine ?? null };
  }

  async openTasksOnWorkLevels(): Promise<readonly TaskOnWorkLevels[]> {
    const [tasks, initiatives] = await Promise.all([this.tasks.list(), this.initiatives.list()]);
    return tasksOnTheirEngines(tasks, initiatives).map(({ task, place, levels }) => ({
      taskId: task.id,
      projectId: task.projectId,
      place,
      work: levels,
    }));
  }
}
