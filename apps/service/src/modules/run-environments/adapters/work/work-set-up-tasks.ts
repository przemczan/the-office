import { Injectable } from "@nestjs/common";
import { RunEnvironmentSetUps, TaskRefused } from "../../../work/index.js";
import { RunEnvironmentSettingRefused } from "../../domain/run-environment-setting-refused.js";
import { SetUpTasks, type AskingUser, type SetUpTask } from "../../ports/set-up-tasks.js";

/** Work's "Set up the run environment" Tasks, each added as the user asked. */
@Injectable()
export class WorkSetUpTasks extends SetUpTasks {
  constructor(private readonly setUps: RunEnvironmentSetUps) {
    super();
  }

  async openOf(projectId: string): Promise<SetUpTask | undefined> {
    const task = await this.setUps.openOf(projectId);
    return task && setUpTaskOf(task);
  }

  async add(projectId: string, by: AskingUser): Promise<SetUpTask> {
    try {
      return setUpTaskOf(await this.setUps.add(projectId, { kind: "user", user: by }));
    } catch (error) {
      if (error instanceof TaskRefused) throw new RunEnvironmentSettingRefused(error.reasons);
      throw error;
    }
  }

  async setUpTaskOf(taskId: string): Promise<SetUpTask | undefined> {
    const task = await this.setUps.find(taskId);
    return task?.madeFor === "run-environment-setup" ? setUpTaskOf(task) : undefined;
  }
}

function setUpTaskOf(task: SetUpTask): SetUpTask {
  return { id: task.id, projectId: task.projectId, title: task.title, state: task.state };
}
