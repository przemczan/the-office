import { randomUUID } from "node:crypto";
import { taskSchema, type Task, type TaskState } from "@the-office/contracts";
import { TaskThreadSetups, type TaskThreadRequest } from "../conversations/index.js";
import { TaskStateChanged } from "./domain/task-events.js";
import { TaskRepository } from "./ports/task-repository.js";
import { sendJson, type WorkApplication } from "./work-application.fixtures.js";

export function aPersonsThread(
  taskId: string,
  roleKey: string,
  firstSession = true,
): TaskThreadRequest {
  return { taskId, roleKey, personsThread: true, firstSession };
}

/** The Tasks and Thread setups the tests share, on whatever app `current` gives. */
export function taskThreads(current: () => WorkApplication) {
  async function aTaskIn(state: TaskState): Promise<Task> {
    const created = await sendJson(current(), "POST", "/tasks", {
      title: "Fix the login redirect",
      projectId: `project-${randomUUID()}`,
      priority: "normal",
    });
    const task = taskSchema.parse(await created.json());
    await current()
      .app.get(TaskRepository)
      .update(task.id, (latest) => ({
        task: { ...latest, state },
        event: new TaskStateChanged(latest.id, latest.state, state),
      }));
    return task;
  }

  function setups(): TaskThreadSetups {
    return current().app.get(TaskThreadSetups);
  }

  return { aTaskIn, setups };
}
