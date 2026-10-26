import { Injectable } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import { makeTaskStages, type TaskStages } from "../domain/task-stages.js";
import { TaskStagesRepository } from "../ports/task-stages-repository.js";
import { PipelineLibrary } from "./pipeline-library.js";

/**
 * Each started Task's own Stages: copied from its library Pipeline as the Task starts, so saving
 * the library later reaches only Tasks that haven't started (spec §2.3).
 */
@Injectable()
export class TaskStagesService {
  constructor(
    private readonly repository: TaskStagesRepository,
    private readonly library: PipelineLibrary,
    private readonly events: EventBus,
  ) {}

  /**
   * Copies the Pipeline's Stages for the Task, once: a Task that already has its own keeps them.
   * Work refuses Start for a Pipeline the library doesn't have, so a missing one is a fault.
   */
  async make(taskId: string, pipelineId: string): Promise<TaskStages> {
    const existing = await this.repository.find(taskId);
    if (existing) return existing;
    const pipeline = await this.library.find(pipelineId);
    if (!pipeline) throw new Error(`There is no Pipeline "${pipelineId}" for Task ${taskId}.`);
    const { taskStages, event } = makeTaskStages(taskId, pipeline, new Date());
    if (await this.repository.saveNew(taskStages)) {
      await this.events.publish(event);
      return taskStages;
    }
    // Made meanwhile by another call: the first copy is the Task's.
    const made = await this.repository.find(taskId);
    if (!made) throw new Error(`Task ${taskId}'s own Stages were neither saved nor found.`);
    return made;
  }

  async find(taskId: string): Promise<TaskStages | undefined> {
    return this.repository.find(taskId);
  }
}
