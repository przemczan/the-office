import { randomUUID } from "node:crypto";
import {
  ideaSchema,
  initiativeSchema,
  taskSchema,
  workRefusalSchema,
  type Idea,
  type Initiative,
  type Task,
} from "@the-office/contracts";
import { expect } from "vitest";
import { EventBus } from "../../platform/events/event-bus.js";
import { TaskStateChanged } from "./domain/task-events.js";
import { TaskRepository } from "./ports/task-repository.js";
import { sendJson, type WorkApplication } from "./work-application.fixtures.js";

/** A Project id of the test's own: every test file shares the database. */
export function aProjectId(): string {
  return `project-${randomUUID()}`;
}

/** The requests the Initiatives routes' tests share, on whatever app `current` gives. */
export function initiativesHttp(current: () => WorkApplication) {
  async function capture(projectId: string | null = null): Promise<Idea> {
    const response = await sendJson(current(), "POST", "/ideas", {
      title: "Usage exports",
      notes: "",
      projectId,
    });
    return ideaSchema.parse(await response.json());
  }

  async function shape(idea: Idea): Promise<Initiative> {
    const response = await sendJson(current(), "POST", `/ideas/${idea.id}/initiative`);
    expect(response.status).toBe(201);
    return initiativeSchema.parse(await response.json());
  }

  async function read(initiative: Initiative): Promise<Initiative> {
    const response = await sendJson(current(), "GET", `/initiatives/${initiative.id}`);
    return initiativeSchema.parse(await response.json());
  }

  async function addTask(
    initiative: Initiative,
    projectId = aProjectId(),
    blockedBy: readonly string[] = [],
  ): Promise<Task> {
    const response = await sendJson(current(), "POST", `/initiatives/${initiative.id}/tasks`, {
      title: "Export endpoint",
      projectId,
      priority: "normal",
      blockedBy,
    });
    expect(response.status).toBe(201);
    return taskSchema.parse(await response.json());
  }

  async function taskOf({ id }: Task): Promise<Task> {
    return taskSchema.parse(await (await sendJson(current(), "GET", `/tasks/${id}`)).json());
  }

  async function reasonsFor(
    task: Task,
    method: "POST" | "PUT",
    path: string,
    body?: unknown,
  ): Promise<readonly string[]> {
    const response = await sendJson(current(), method, `/tasks/${task.id}${path}`, body);
    expect(response.status).toBe(422);
    return workRefusalSchema.parse(await response.json()).reasons;
  }

  async function post(initiative: Initiative, action: "confirm" | "drop"): Promise<Response> {
    return sendJson(current(), "POST", `/initiatives/${initiative.id}/${action}`);
  }

  /** As the walk ends a Task's work, which this module leaves to Pipelines. */
  async function end(task: Task, to: "done" | "dropped"): Promise<void> {
    const { event } = await current()
      .app.get(TaskRepository)
      .update(task.id, (held) => ({
        task: { ...held, state: to },
        event: new TaskStateChanged(held.id, held.state, to),
      }));
    if (event) await current().app.get(EventBus).publish(event);
  }

  return { capture, shape, read, addTask, taskOf, reasonsFor, post, end };
}
