import { Injectable, Module } from "@nestjs/common";
import { StartedTasks, type StartedTask, type WalkTaskState } from "./started-tasks.js";

/** Work's Tasks in memory: a test starts each one it walks. */
@Injectable()
export class StartedTasksForTests extends StartedTasks {
  private readonly tasks = new Map<string, StartedTask>();
  /** Every state the walk moved a Task to, in order. */
  readonly changes: { readonly taskId: string; readonly state: WalkTaskState }[] = [];

  /** Puts the Task as Work would, such as In progress as it starts. */
  put(taskId: string, task: StartedTask): void {
    this.tasks.set(taskId, task);
  }

  async read(taskId: string): Promise<StartedTask> {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`There is no Task ${taskId}.`);
    return task;
  }

  async changeState(taskId: string, state: WalkTaskState): Promise<void> {
    this.put(taskId, { ...(await this.read(taskId)), state });
    this.changes.push({ taskId, state });
  }
}

@Module({ providers: [StartedTasksForTests], exports: [StartedTasksForTests] })
export class PipelinesPortsForTestsModule {}
