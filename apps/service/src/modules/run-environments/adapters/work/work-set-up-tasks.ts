import { Injectable } from "@nestjs/common";
import { RunEnvironmentSetUps, type OffBoardTaskStart } from "../../../work/index.js";
import { SetUpTasks, type AskingUser, type SetUpTask } from "../../ports/set-up-tasks.js";

/** Work's "Set up the run environment" Tasks, each made and started as the user asked. */
@Injectable()
export class WorkSetUpTasks extends SetUpTasks {
  constructor(private readonly setUps: RunEnvironmentSetUps) {
    super();
  }

  async openOf(projectId: string): Promise<SetUpTask | undefined> {
    const task = await this.setUps.openOf(projectId);
    return task && setUpTaskOf(task);
  }

  add(projectId: string, by: AskingUser): Promise<OffBoardTaskStart> {
    return this.setUps.add(projectId, { kind: "user", user: by });
  }

  async setUpTaskOf(taskId: string): Promise<SetUpTask | undefined> {
    const task = await this.setUps.find(taskId);
    return task?.madeFor === "run-environment-setup" ? setUpTaskOf(task) : undefined;
  }

  async projectOf(taskId: string): Promise<string | undefined> {
    return (await this.setUps.find(taskId))?.projectId;
  }
}

function setUpTaskOf(task: SetUpTask): SetUpTask {
  return { id: task.id, projectId: task.projectId, title: task.title, state: task.state };
}
