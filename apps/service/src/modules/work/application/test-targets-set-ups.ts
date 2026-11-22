import { Injectable } from "@nestjs/common";
import type { Task } from "../domain/task.js";
import { isOpenTestTargetsSetUp } from "../domain/test-targets-set-up.js";
import { TaskRepository } from "../ports/task-repository.js";

/**
 * A Project's open "Set up test targets" Task, made before the Project page asked in a chat
 * instead (spec §2.12): The Office makes no new one, and one still open keeps working.
 */
@Injectable()
export class TestTargetsSetUps {
  constructor(private readonly tasks: TaskRepository) {}

  /** The Project's open set-up Task; undefined when it has none. */
  async openOf(projectId: string): Promise<Task | undefined> {
    return (await this.tasks.madeFor("test-targets-setup", projectId)).find(isOpenTestTargetsSetUp);
  }
}
