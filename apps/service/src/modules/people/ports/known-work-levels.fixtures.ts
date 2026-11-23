import { Injectable, Module } from "@nestjs/common";
import type { EngineId } from "../../engine/index.js";
import { isOverridden, type WorkCascadeLevels } from "../domain/engine-cascade.js";
import { KnownWorkLevels, type TaskOnWorkLevels, type WorkLevelsOf } from "./known-work-levels.js";

/**
 * Tasks' and Initiatives' engine overrides as a test sets them; none set for any until it does. A
 * Task's Initiative's override comes with it once `setInitiativeOf` puts it in one. A Task is open,
 * in a Project, once `setOpenTask` says so.
 */
@Injectable()
export class WorkLevelsForTests implements KnownWorkLevels {
  private readonly tasks = new Map<string, EngineId>();
  private readonly initiatives = new Map<string, EngineId>();
  private readonly initiativeOfTask = new Map<string, string>();
  private readonly openTasks = new Map<string, { projectId: string; title: string }>();

  setForTask(taskId: string, engineId: EngineId | null): void {
    if (engineId === null) this.tasks.delete(taskId);
    else this.tasks.set(taskId, engineId);
  }

  setForInitiative(initiativeId: string, engineId: EngineId | null): void {
    if (engineId === null) this.initiatives.delete(initiativeId);
    else this.initiatives.set(initiativeId, engineId);
  }

  setInitiativeOf(taskId: string, initiativeId: string): void {
    this.initiativeOfTask.set(taskId, initiativeId);
  }

  setOpenTask(taskId: string, projectId: string, title: string): void {
    this.openTasks.set(taskId, { projectId, title });
  }

  async openTasksOnWorkLevels(): Promise<readonly TaskOnWorkLevels[]> {
    const tasks = await Promise.all(
      [...this.openTasks].map(async ([taskId, { projectId, title }]) => ({
        taskId,
        projectId,
        place: `On “${title}”`,
        work: await this.engineLevelsOf({ taskId }),
      })),
    );
    return tasks.filter(({ work }) => isOverridden(work));
  }

  async engineLevelsOf(of: WorkLevelsOf): Promise<WorkCascadeLevels> {
    if ("initiativeId" in of) {
      return {
        taskEngineOverride: null,
        initiativeEngineOverride: this.initiatives.get(of.initiativeId) ?? null,
      };
    }
    const initiativeId = this.initiativeOfTask.get(of.taskId);
    return {
      taskEngineOverride: this.tasks.get(of.taskId) ?? null,
      initiativeEngineOverride:
        initiativeId === undefined ? null : (this.initiatives.get(initiativeId) ?? null),
    };
  }
}

/** Provides `WorkLevelsForTests`, for a test registering `EngineCascadeModule` without Work. */
@Module({ providers: [WorkLevelsForTests], exports: [WorkLevelsForTests] })
export class WorkLevelsForTestsModule {}
