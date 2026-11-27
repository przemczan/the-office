import { Injectable } from "@nestjs/common";
import { RunEnvironmentSetUps, type OffBoardTaskStart } from "../../../work/index.js";
import type { ActedBy } from "../../../projects/index.js";
import { SetUpTasks, type SetUpTask } from "../../ports/set-up-tasks.js";

/** Work's "Set up the run environment" Tasks, each made and started as the user or person asked. */
@Injectable()
export class WorkSetUpTasks extends SetUpTasks {
  constructor(private readonly setUps: RunEnvironmentSetUps) {
    super();
  }

  async openOf(projectId: string): Promise<SetUpTask | undefined> {
    const task = await this.setUps.openOf(projectId);
    return task && setUpTaskOf(task);
  }

  add(projectId: string, by: ActedBy): Promise<OffBoardTaskStart> {
    return this.setUps.add(projectId, createdByOf(by));
  }

  async setUpTaskOf(taskId: string): Promise<SetUpTask | undefined> {
    const task = await this.setUps.find(taskId);
    return task?.madeFor === "run-environment-setup" ? setUpTaskOf(task) : undefined;
  }
}

/** Who asked, as Work's Author: the user, or the person by their Role with the users behind them. */
function createdByOf(by: ActedBy): Parameters<RunEnvironmentSetUps["add"]>[1] {
  if (by.kind === "user")
    return { kind: "user", user: { userId: by.user.userId, name: by.user.name } };
  const { roleKey, askedBy, allowedBy } = by;
  return {
    kind: "person",
    roleKey,
    ...(askedBy && { askedBy: { userId: askedBy.userId, name: askedBy.name } }),
    ...(allowedBy && { allowedBy: { userId: allowedBy.userId, name: allowedBy.name } }),
  };
}

function setUpTaskOf(task: SetUpTask): SetUpTask {
  return { id: task.id, projectId: task.projectId, title: task.title, state: task.state };
}
