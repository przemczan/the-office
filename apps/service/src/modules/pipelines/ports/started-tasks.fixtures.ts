import type { ProviderOverride } from "../../../../test/test-application.js";
import { TaskService } from "../../work/index.js";
import {
  StartedTasks,
  type StartedTask,
  type TaskBlocker,
  type UsageWindowRefusal,
  type WalkTaskState,
} from "./started-tasks.js";

/**
 * Work's Tasks on the shared database, listed only from the test's own Projects: as an app starts it
 * takes up every run left running among the Tasks it lists, ending each as The Office restarted
 * during it and walking the Task on with its own engine, so without this one file's app ends
 * another file's running Stages and takes its scripted sessions (apps/service/docs/testing.md).
 */
export class OwnProjectsStartedTasks extends StartedTasks {
  constructor(
    private readonly tasks: StartedTasks,
    private readonly ownProjectIds: () => readonly string[],
  ) {
    super();
  }

  async list(): Promise<readonly StartedTask[]> {
    const own = this.ownProjectIds();
    return (await this.tasks.list()).filter(({ projectId }) => own.includes(projectId));
  }

  read(taskId: string): Promise<StartedTask> {
    return this.tasks.read(taskId);
  }

  find(taskId: string): Promise<StartedTask | undefined> {
    return this.tasks.find(taskId);
  }

  changeState(taskId: string, state: WalkTaskState): Promise<StartedTask> {
    return this.tasks.changeState(taskId, state);
  }

  hold(taskId: string, reason: string): Promise<StartedTask> {
    return this.tasks.hold(taskId, reason);
  }

  holdForFireAlarm(taskId: string): Promise<boolean> {
    return this.tasks.holdForFireAlarm(taskId);
  }

  pauseForUsageWindow(taskId: string, refusal: UsageWindowRefusal): Promise<StartedTask> {
    return this.tasks.pauseForUsageWindow(taskId, refusal);
  }

  resume(taskId: string): Promise<StartedTask> {
    return this.tasks.resume(taskId);
  }

  drop(taskId: string): Promise<StartedTask> {
    return this.tasks.drop(taskId);
  }

  waitingFor(taskId: string): Promise<readonly TaskBlocker[]> {
    return this.tasks.waitingFor(taskId);
  }
}

/**
 * The started Tasks as the test's own Projects see them, for an app with the whole of Pipelines on
 * Work's Tasks (the composition root); with none, its start takes up nothing.
 */
export function ownProjectsStartedTasks(
  ownProjectIds: () => readonly string[] = () => [],
): ProviderOverride {
  return {
    provide: StartedTasks,
    useFactory: (tasks: TaskService) => new OwnProjectsStartedTasks(tasks, ownProjectIds),
    inject: [TaskService],
  };
}
