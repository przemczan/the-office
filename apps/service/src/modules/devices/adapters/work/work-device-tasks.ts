import { Injectable } from "@nestjs/common";
import { TaskService } from "../../../work/index.js";
import { DeviceTasks, type DeviceTask } from "../../ports/device-tasks.js";

/** Work's Tasks, through its `TaskService`. */
@Injectable()
export class WorkDeviceTasks extends DeviceTasks {
  constructor(private readonly tasks: TaskService) {
    super();
  }

  async find(taskId: string): Promise<DeviceTask | undefined> {
    const task = await this.tasks.find(taskId);
    return task && { id: task.id, title: task.title, projectId: task.projectId, state: task.state };
  }
}
